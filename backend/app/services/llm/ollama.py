"""
Ollama client tuned for Qwen3 8B.
Resolves a working base URL automatically (docker service name, localhost, host gateway).
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Dict, Any, Optional

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger()


def _candidate_base_urls() -> List[str]:
    """Ordered list of Ollama endpoints to try."""
    primary = (settings.OLLAMA_BASE_URL or "http://localhost:11434").rstrip("/")
    candidates = [
        primary,
        "http://ollama:11434",
        "http://localhost:11434",
        "http://127.0.0.1:11434",
        "http://host.docker.internal:11434",
    ]
    # unique, preserve order
    seen = set()
    out = []
    for u in candidates:
        u = u.rstrip("/")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


class OllamaService:
    def __init__(self):
        self.model = settings.OLLAMA_MODEL
        self.timeout = httpx.Timeout(300.0, connect=10.0)
        self._resolved_base: Optional[str] = None

    @property
    def base_url(self) -> str:
        return self._resolved_base or settings.OLLAMA_BASE_URL.rstrip("/")

    async def resolve_base_url(self, force: bool = False) -> str:
        """Find a reachable Ollama instance and cache it."""
        if self._resolved_base and not force:
            return self._resolved_base

        last_err: Optional[Exception] = None
        for url in _candidate_base_urls():
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    r = await client.get(f"{url}/api/tags")
                    if r.status_code < 500:
                        self._resolved_base = url
                        logger.info("ollama_resolved", base_url=url, status=r.status_code)
                        return url
            except Exception as e:
                last_err = e
                logger.debug("ollama_probe_failed", url=url, error=str(e))
                continue

        raise RuntimeError(
            "Ollama-д холбогдож чадсангүй / Cannot reach Ollama. "
            f"Tried: {', '.join(_candidate_base_urls())}. "
            "docker compose up -d ollama && ./scripts/init_ollama.sh "
            f"(last error: {last_err})"
        )

    async def health_check(self) -> Dict[str, Any]:
        try:
            base = await self.resolve_base_url()
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(f"{base}/api/tags")
                r.raise_for_status()
                data = r.json()
                models = [m.get("name") for m in data.get("models", [])]
                model_loaded = self._model_in_list(models)
                return {
                    "available": True,
                    "models": models,
                    "current_model": self.model,
                    "model_loaded": model_loaded,
                    "base_url": base,
                    "hint": None
                    if model_loaded
                    else f"Model '{self.model}' not pulled. Run: ollama pull {self.model}",
                }
        except Exception as e:
            logger.error("ollama_health_failed", error=str(e))
            return {
                "available": False,
                "error": str(e),
                "base_url": self.base_url,
                "current_model": self.model,
                "models": [],
                "model_loaded": False,
            }

    def _model_in_list(self, models: List[Optional[str]]) -> bool:
        target = self.model
        for m in models:
            if not m:
                continue
            if m == target or m.startswith(target) or target in m:
                return True
            # qwen3:8b matches qwen3:8b-xxx tags
            if target.split(":")[0] in m and "8b" in m.lower():
                return True
        return False

    async def ensure_model_name(self) -> str:
        """
        Prefer configured model; if missing, pick closest qwen3 8b from tags.
        """
        health = await self.health_check()
        if not health.get("available"):
            raise RuntimeError(health.get("error") or "Ollama unavailable")

        models = health.get("models") or []
        if self._model_in_list(models):
            # exact match preferred
            for m in models:
                if m == self.model:
                    return m
            for m in models:
                if m and (m.startswith(self.model) or self.model in m):
                    return m
            for m in models:
                if m and "qwen3" in m.lower() and "8b" in m.lower():
                    logger.warning("ollama_using_fallback_model", configured=self.model, using=m)
                    return m
        return self.model

    def _default_system_prompt(self) -> str:
        return (
            "You are a helpful, accurate, and concise AI assistant powered by Qwen3. "
            "Answer in the same language the user writes in. "
            "Be clear, structured, and useful. Use markdown when it improves readability "
            "(lists, code blocks, headings). "
            "If you are unsure, say so instead of inventing facts."
        )

    def _apply_thinking_mode(self, messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
        mode = (settings.QWEN_THINKING_MODE or "auto").lower()
        if mode == "auto" or not messages:
            return messages
        last = dict(messages[-1])
        content = last.get("content") or ""
        if mode == "on" and "/think" not in content and "/no_think" not in content:
            last["content"] = content + "\n/think"
            return messages[:-1] + [last]
        if mode == "off" and "/no_think" not in content and "/think" not in content:
            last["content"] = content + "\n/no_think"
            return messages[:-1] + [last]
        return messages

    def _trim_history(self, messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
        max_n = settings.MAX_HISTORY_MESSAGES
        if len(messages) <= max_n:
            return messages
        return messages[-max_n:]

    async def generate_title(self, user_message: str, assistant_message: str = "") -> str:
        base = await self.resolve_base_url()
        model = await self.ensure_model_name()
        prompt = (
            "Create a very short chat title (max 6 words) for this message. "
            "Same language as the message. No quotes, no punctuation only:\n\n"
            f"{user_message[:500]}"
        )
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{base}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.3,
                            "num_predict": 24,
                            "top_p": 0.9,
                        },
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                title = (data.get("response") or "").strip().strip('"').strip("'")
                title = title.replace("/think", "").replace("/no_think", "").strip()
                if not title or len(title) > 80:
                    title = user_message[:48].strip() + ("…" if len(user_message) > 48 else "")
                return title
        except Exception as e:
            logger.warning("title_generation_failed", error=str(e))
            return user_message[:48].strip() + ("…" if len(user_message) > 48 else "")

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        stop_event=None,
        extra_options: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from Ollama /api/chat for Qwen3."""
        try:
            base = await self.resolve_base_url()
            model = await self.ensure_model_name()
        except Exception as e:
            raise RuntimeError(str(e)) from e

        payload_messages: List[Dict[str, str]] = []
        sys = system_prompt or self._default_system_prompt()
        payload_messages.append({"role": "system", "content": sys})

        history = self._trim_history(messages)
        history = self._apply_thinking_mode(history)
        payload_messages.extend(history)

        options = {
            "temperature": settings.OLLAMA_TEMPERATURE,
            "top_p": settings.OLLAMA_TOP_P,
            "num_predict": settings.OLLAMA_NUM_PREDICT,
            "num_ctx": min(settings.OLLAMA_CONTEXT_LENGTH, 32768),
        }
        if extra_options:
            options.update(extra_options)

        payload = {
            "model": model,
            "messages": payload_messages,
            "stream": True,
            "options": options,
        }

        def should_stop() -> bool:
            if stop_event is None:
                return False
            if hasattr(stop_event, "is_set"):
                return stop_event.is_set()
            if callable(stop_event):
                return bool(stop_event())
            return False

        logger.info("ollama_stream_start", base_url=base, model=model)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    f"{base}/api/chat",
                    json=payload,
                ) as response:
                    if response.status_code >= 400:
                        body = await response.aread()
                        text = body.decode(errors="replace")[:500]
                        logger.error(
                            "ollama_http_error",
                            status=response.status_code,
                            body=text,
                            model=model,
                            base_url=base,
                        )
                        # Force re-resolve next time
                        self._resolved_base = None
                        if response.status_code == 404:
                            raise RuntimeError(
                                f"Model '{model}' олдсонгүй. Ажиллуул: "
                                f"docker exec -it chatbot-ollama ollama pull {settings.OLLAMA_MODEL}"
                            )
                        raise RuntimeError(f"Ollama error {response.status_code}: {text}")

                    async for line in response.aiter_lines():
                        if should_stop():
                            logger.info("generation_stopped_by_user")
                            break
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if data.get("done"):
                            break
                        # Some Ollama builds put error in stream body
                        if data.get("error"):
                            raise RuntimeError(str(data["error"]))
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
        except httpx.ConnectError as e:
            self._resolved_base = None
            logger.error("ollama_stream_connect_failed", base_url=base, error=str(e))
            raise RuntimeError(
                f"Ollama-д холбогдож чадсангүй ({base}). "
                f"docker compose up -d ollama && ./scripts/init_ollama.sh"
            ) from e
        except httpx.HTTPStatusError as e:
            self._resolved_base = None
            logger.error("ollama_http_error", status=e.response.status_code)
            raise RuntimeError(f"Ollama HTTP error: {e.response.status_code}") from e
        except Exception as e:
            if "Ollama" in str(e) or "Model" in str(e) or "олдсонгүй" in str(e) or "холбогдож" in str(e):
                raise
            logger.error("ollama_stream_error", error=str(e))
            raise RuntimeError(f"Generation failed: {e}") from e


ollama_service = OllamaService()
