"""
Ollama client tuned for Qwen3 8B.
Resolves a working base URL automatically (docker service name, localhost, host gateway).
"""

from __future__ import annotations

import json
import time
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
        self._client: Optional[httpx.AsyncClient] = None
        self._model_cache = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout, trust_env=False,
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            )
        return self._client

    async def aclose(self):
        if self._client is not None:
            await self._client.aclose()
            self._client = None

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
                r = await self._http().get(f"{url}/api/tags", timeout=2.0)
                if r.status_code == 200 and isinstance(r.json().get("models"), list):
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
            r = await self._http().get(f"{base}/api/tags", timeout=15.0)
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
                "hint": None if model_loaded else f"Model '{self.model}' not pulled. Run: ollama pull {self.model}",
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
        return self.model in models or (":" not in self.model and self.model + ":latest" in models)

    async def ensure_model_name(self) -> str:
        """Cache model discovery without silently substituting a different model."""
        cache_key = (self.model, self.base_url)
        if self._model_cache and self._model_cache[0] == cache_key and time.monotonic() < self._model_cache[1]:
            return self._model_cache[2]
        health = await self.health_check()
        if not health.get("available"):
            raise RuntimeError(health.get("error") or "Ollama unavailable")

        models = health.get("models") or []
        if not self._model_in_list(models):
            raise RuntimeError(f"Model '{self.model}' олдсонгүй. Run: ollama pull {self.model}")
        selected = self.model if self.model in models else self.model + ":latest"
        self._model_cache = ((self.model, self.base_url), time.monotonic() + 60, selected)
        return selected

    def _default_system_prompt(self) -> str:
        from app.services.answering import SYSTEM_PROMPT
        return SYSTEM_PROMPT

    def _trim_history(self, messages: List[Dict[str, str]], system_prompt: str = "") -> List[Dict[str, str]]:
        # Approximate UTF-8 token cost; retain complete recent turns and never
        # lose the latest question. This is not an exact model tokenizer.
        def cost(text):
            return (len(text.encode("utf-8")) + 1) // 2 + 12

        groups = []
        for message in messages[-max(1, settings.MAX_HISTORY_MESSAGES):]:
            if not message.get("content"):
                continue
            if message.get("role") == "user":
                groups.append([dict(message)])
            elif message.get("role") == "assistant" and groups:
                groups[-1].append(dict(message))
        if not groups:
            return []
        context = min(settings.OLLAMA_CONTEXT_LENGTH, 32768)
        reserve = min(settings.OLLAMA_NUM_PREDICT, context // 3)
        remaining = context - reserve - cost(system_prompt) - 128
        kept = [groups[-1]]
        remaining -= sum(cost(m["content"]) for m in groups[-1])
        for group in reversed(groups[:-1]):
            size = sum(cost(m["content"]) for m in group)
            if size > remaining:
                break
            kept.insert(0, group)
            remaining -= size
        return [message for group in kept for message in group]

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
                        "think": False,
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
        metrics: Optional[Dict[str, Any]] = None,
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

        history = self._trim_history(messages, sys)
        payload_messages.extend(history)

        options = {
            "temperature": settings.OLLAMA_TEMPERATURE,
            "top_p": settings.OLLAMA_TOP_P,
            "top_k": settings.OLLAMA_TOP_K,
            "min_p": settings.OLLAMA_MIN_P,
            "num_predict": settings.OLLAMA_NUM_PREDICT,
            "num_ctx": min(settings.OLLAMA_CONTEXT_LENGTH, 32768),
        }
        if extra_options:
            options.update(extra_options)

        payload = {
            "model": model,
            "messages": payload_messages,
            "stream": True,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
            "options": options,
        }
        mode = (settings.QWEN_THINKING_MODE or "auto").lower()
        if mode in ("off", "no_think", "on", "think"):
            payload["think"] = mode in ("on", "think")

        def should_stop() -> bool:
            if stop_event is None:
                return False
            if hasattr(stop_event, "is_set"):
                return stop_event.is_set()
            if callable(stop_event):
                return bool(stop_event())
            return False

        logger.info("ollama_stream_start", base_url=base, model=model)

        started = time.perf_counter()
        first_token = None
        completed = False
        try:
            client = self._http()
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
                    self._model_cache = None
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
                    # Some Ollama builds put error in stream body
                    if data.get("error"):
                        raise RuntimeError(str(data["error"]))
                    content = data.get("message", {}).get("content", "")
                    if content:
                        if first_token is None:
                            first_token = time.perf_counter() - started
                        yield content
                    if data.get("done"):
                        completed = True
                        if metrics is not None:
                            metrics.update({
                                "first_token_ms": round(first_token * 1000) if first_token is not None else None,
                                "total_ms": round((time.perf_counter() - started) * 1000),
                                "output_tokens": data.get("eval_count"),
                                "prompt_tokens": data.get("prompt_eval_count"),
                                "done_reason": data.get("done_reason"),
                            })
                        break
            if not completed and not should_stop():
                raise RuntimeError("Ollama stream ended before completion. Please retry.")
        except httpx.ConnectError as e:
            self._resolved_base = None
            self._model_cache = None
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
