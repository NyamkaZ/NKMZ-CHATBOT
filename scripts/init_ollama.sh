#!/usr/bin/env bash
# Pull the primary model into the Ollama container.
set -euo pipefail

MODEL="${OLLAMA_MODEL:-qwen3:8b}"
CONTAINER="${OLLAMA_CONTAINER:-chatbot-ollama}"

echo "==> Waiting for Ollama ($CONTAINER)..."
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" ollama list >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Pulling model: $MODEL"
docker exec -it "$CONTAINER" ollama pull "$MODEL"

echo "==> Optional: pull embedding model"
docker exec -it "$CONTAINER" ollama pull nomic-embed-text || true

echo "==> Done. Models available:"
docker exec "$CONTAINER" ollama list
