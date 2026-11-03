#!/usr/bin/env bash
set -euo pipefail

echo "==> Docker containers"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAME|ollama|backend' || true

echo ""
echo "==> Ollama HTTP (localhost:11434)"
if curl -sf --max-time 5 http://localhost:11434/api/tags >/tmp/ollama_tags.json; then
  echo "OK — Ollama responding"
  python3 -c "import json; d=json.load(open('/tmp/ollama_tags.json')); print('Models:', [m.get('name') for m in d.get('models',[])])"
else
  echo "FAIL — cannot reach http://localhost:11434"
  echo "Fix: docker compose up -d ollama"
  exit 1
fi

echo ""
echo "==> Backend → Ollama (inside container network)"
if docker exec chatbot-backend python -c "
import httpx, os
url=os.getenv('OLLAMA_BASE_URL','http://ollama:11434')
r=httpx.get(url+'/api/tags', timeout=10)
print('OLLAMA_BASE_URL=', url, 'status=', r.status_code)
print('models=', [m.get('name') for m in r.json().get('models',[])])
" 2>/dev/null; then
  echo "OK — backend can reach Ollama"
else
  echo "FAIL — backend cannot reach Ollama"
  echo "Check OLLAMA_BASE_URL in docker-compose (should be http://ollama:11434)"
fi

MODEL="${OLLAMA_MODEL:-qwen3:8b}"
echo ""
echo "==> Ensure model: $MODEL"
docker exec chatbot-ollama ollama list 2>/dev/null || true
if ! docker exec chatbot-ollama ollama list 2>/dev/null | grep -q "${MODEL%%:*}"; then
  echo "Pulling $MODEL ..."
  docker exec -it chatbot-ollama ollama pull "$MODEL"
fi
echo "Done."
