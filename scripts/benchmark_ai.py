"""Small synthetic local Ollama comparison; never reads chat records or credentials."""
import argparse
import ast
import asyncio
import json
import sys
from pathlib import Path
import time

import httpx

CASES = (
    ("arithmetic", [{"role": "user", "content": "Reply with only the number: 17 * 23."}], 16, "391"),
    ("conversation_memory", [
        {"role": "user", "content": "My project is called NKMZ. Remember the project name."},
        {"role": "assistant", "content": "Your project is called NKMZ."},
        {"role": "user", "content": "What is my project called? Reply with only the name."},
    ], 16, "NKMZ"),
    ("mongolian", [{"role": "user", "content": "Монгол хэлээр нэг өгүүлбэрээр Python-ийн list гэж юу болохыг тайлбарла."}], 96, None),
)
QUALITY_CASES = (
    ("missing_company_fact", [{"role": "user", "content": "What is NKMZ's support phone number? If no verified number is provided, reply UNKNOWN only."}], 32, "UNKNOWN"),
    ("reference_fact", [{"role": "user", "content": "Reference data: The office opens at 09:00 and closes at 18:00 Monday to Friday. What time does it open on Tuesday? Reply with HH:MM only."}], 24, "09:00"),
    ("python_function", [{"role": "user", "content": "Write only a Python function is_even(n) that returns True for even integers and False for odd integers. No explanation or markdown fences."}], 160, None),
)
SYSTEM = ("You are the official NKMZ Chat assistant. Answer in the same language the user writes in "
          "(Mongolian or English). Be warm, clear, and concise. If unsure, say you do not know. "
          "Never invent prices, hours, or phone numbers. No chain-of-thought; give the final answer only.")


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:11434")
    parser.add_argument("--label", required=True)
    parser.add_argument("--model", default="qwen3:8b")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--app-policy", action="store_true", help="Use the current NKMZ answer policy and sampling settings")
    parser.add_argument("--extended", action="store_true", help="Also check unknown facts, supplied references and Python syntax")
    args = parser.parse_args()
    system = SYSTEM
    sampling = {"temperature": 0.7, "top_p": 0.9}
    if args.app_policy:
        sys.path.insert(0, str(Path.cwd()))
        from app.services.answering import SYSTEM_PROMPT
        from app.core.config import settings
        system = SYSTEM_PROMPT
        sampling = {"temperature": settings.OLLAMA_TEMPERATURE, "top_p": settings.OLLAMA_TOP_P,
                    "top_k": settings.OLLAMA_TOP_K, "min_p": settings.OLLAMA_MIN_P}
    report = {"label": args.label, "model": args.model, "data": "synthetic prompts only", "app_policy": args.app_policy, "cases": []}
    async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=10), trust_env=False) as client:
        # Empty chat loads the model; report cold load separately from warm requests.
        start = time.perf_counter()
        loaded = await client.post(args.url + "/api/chat", json={"model": args.model, "messages": [], "stream": False, "keep_alive": "30m"})
        loaded.raise_for_status()
        report["warmup_seconds"] = round(time.perf_counter() - start, 3)
        for name, messages, budget, expected in CASES + (QUALITY_CASES if args.extended else ()):
            # Policy evaluation needs room for a complete Cyrillic answer;
            # controlled CPU/GPU comparisons retain the identical 96-token cap.
            if args.app_policy and name == "mongolian":
                budget = 192
            start = time.perf_counter()
            first = None
            text = ""
            final = {}
            async with client.stream("POST", args.url + "/api/chat", json={
                "model": args.model, "messages": [{"role": "system", "content": system}, *messages],
                "think": False, "stream": True, "keep_alive": "30m",
                "options": {**sampling, "num_ctx": 4096, "num_predict": budget, "seed": 42},
            }) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    item = json.loads(line)
                    if item.get("error"):
                        raise RuntimeError(item["error"])
                    token = item.get("message", {}).get("content", "")
                    if token and first is None:
                        first = time.perf_counter() - start
                    text += token
                    if item.get("done"):
                        final = item
            elapsed = time.perf_counter() - start
            duration = final.get("eval_duration", 0) / 1e9
            result = {"name": name, "first_token_seconds": round(first, 3) if first is not None else None,
                      "total_seconds": round(elapsed, 3), "output_tokens": final.get("eval_count"),
                      "tokens_per_second": round(final.get("eval_count", 0) / duration, 2) if duration else None,
                      "done_reason": final.get("done_reason"), "response": text.strip(),
                      "expected": expected, "exact_match": text.strip() == expected if expected else None}
            if name == "python_function":
                try:
                    tree = ast.parse(text.strip())
                    result["python_syntax_valid"] = any(isinstance(node, ast.FunctionDef) and node.name == "is_even" for node in tree.body)
                except SyntaxError:
                    result["python_syntax_valid"] = False
            report["cases"].append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        active = await client.get(args.url + "/api/ps")
        active.raise_for_status()
        report["active_models"] = [{k: model.get(k) for k in ("name", "size", "size_vram", "context_length")} for model in active.json().get("models", [])]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.output), "warmup_seconds": report["warmup_seconds"]}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
