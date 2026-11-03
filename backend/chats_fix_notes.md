# chats.py — required edits

Three edits in `backend/app/api/v1/endpoints/chats.py`.

## 1. Imports

Add to the `app.services.generation` import block:

```python
from app.services.generation import (
    is_generation_active,
    set_active_generation,
    start_generation_task,
    request_stop,
    get_generation_state,
    clear_active_generation,
)
```

Add at the top of the file:

```python
from datetime import datetime, timezone
```

## 2. Replace the stale-lock block inside `send_message`

Delete the whole `# Clear any stale generation lock so send never freezes`
block (the `is_generation_active` + `clear_active_generation` + `sa_update`
section) and replace it with:

```python
    # One message at a time per chat: a second send while a response is
    # being generated is rejected instead of starting a competing task.
    if await is_generation_active(str(chat.id)):
        raise HTTPException(
            status_code=409,
            detail="Энэ чат дээр хариу үүсэж байна. Дуусахыг хүлээнэ үү.",
        )
```

The frontend should treat `409` as "input disabled until the current stream
finishes" and re-attach to the existing stream rather than showing an error.

## 3. Fix the chat timestamp

Replace:

```python
    chat.updated_at = user_msg.created_at
```

with:

```python
    chat.updated_at = datetime.now(timezone.utc)
```

A freshly flushed `user_msg` may not have `created_at` populated yet, which
can violate the `NOT NULL` constraint on `chats.updated_at`.

---

# docker-compose.yml — required edits

1. Comment out `gpus: all` under the `ollama` service — it makes
   `docker compose up` fail on CPU-only machines.
2. Remove the ineffective `OLLAMA_MODEL=nkmz-qwen` and
   `OLLAMA_NUM_PREDICT=512` entries from the `ollama` service; Ollama does not
   read those environment variables.
3. Raise `OLLAMA_CONTEXT_LENGTH` from `2048` to `8192` so RAG context fits.
