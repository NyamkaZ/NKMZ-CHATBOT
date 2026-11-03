"""
Background generation service — streams Ollama → Redis → SSE.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import structlog
from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.redis import get_redis
from app.models.chat import Chat, Message, MessageRole, MessageStatus
from app.services.llm.ollama import ollama_service

logger = structlog.get_logger()

_stop_flags: Dict[str, asyncio.Event] = {}
_active_tasks: Dict[str, asyncio.Task] = {}

GEN_TTL_SECONDS = 900


def _gen_key(generation_id: str) -> str:
    return f"gen:{generation_id}"


async def is_generation_active(chat_id: str) -> bool:
    redis = await get_redis()
    return bool(await redis.get(f"chat:{chat_id}:active_gen"))


async def set_active_generation(chat_id: str, generation_id: str, ttl: int = GEN_TTL_SECONDS):
    redis = await get_redis()
    await redis.set(f"chat:{chat_id}:active_gen", generation_id, ex=ttl)


async def clear_active_generation(chat_id: str):
    redis = await get_redis()
    await redis.delete(f"chat:{chat_id}:active_gen")


async def request_stop(generation_id: str) -> bool:
    redis = await get_redis()
    await redis.set(f"{_gen_key(generation_id)}:stop", "1", ex=120)
    if generation_id in _stop_flags:
        _stop_flags[generation_id].set()
    return True


async def get_generation_state(generation_id: str) -> Optional[Dict[str, Any]]:
    redis = await get_redis()
    raw = await redis.hgetall(_gen_key(generation_id))
    if not raw:
        return None
    # decode_responses=True, so keys/values are already str — the isinstance
    # checks below are a safety net for clients configured without it.
    data: Dict[str, Any] = {}
    for k, v in raw.items():
        kk = k.decode() if isinstance(k, bytes) else k
        vv = v.decode() if isinstance(v, bytes) else v
        data[kk] = vv
    tokens = await redis.lrange(f"{_gen_key(generation_id)}:tokens", 0, -1)
    tokens = [t.decode() if isinstance(t, bytes) else t for t in tokens]
    data["tokens"] = tokens
    data["content"] = "".join(tokens) if tokens else data.get("content", "")
    return data


async def _publish(generation_id: str, event: str, data: dict):
    redis = await get_redis()
    payload = json.dumps({"event": event, "data": data})
    await redis.publish(f"{_gen_key(generation_id)}:channel", payload)
    await redis.set(f"{_gen_key(generation_id)}:last", payload, ex=GEN_TTL_SECONDS)


async def run_generation(
    generation_id: str,
    message_id: str,
    chat_id: str,
    history: List[Dict[str, str]],
    system_prompt: Optional[str] = None,
    is_first_message: bool = False,
    user_message_content: str = "",
):
    logger.info(
        "run_generation_start",
        generation_id=generation_id,
        chat_id=chat_id,
        history_len=len(history),
    )
    redis = await get_redis()
    stop_event = asyncio.Event()
    _stop_flags[generation_id] = stop_event

    key = _gen_key(generation_id)
    await redis.hset(
        key,
        mapping={
            "status": "thinking",
            "message_id": message_id,
            "chat_id": chat_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await redis.expire(key, GEN_TTL_SECONDS)
    await _publish(generation_id, "thinking", {"message": "Thinking..."})

    full_content = ""
    status = MessageStatus.FAILED
    error_msg = None

    try:
        await asyncio.sleep(0.3)
        if stop_event.is_set() or await redis.get(f"{key}:stop"):
            status = MessageStatus.STOPPED
            raise asyncio.CancelledError()

        await redis.hset(key, "status", "streaming")
        await _publish(generation_id, "status", {"status": "streaming"})
        logger.info("calling_ollama", generation_id=generation_id, model=settings.OLLAMA_MODEL)

        token_count = 0
        async for token in ollama_service.stream_chat(
            messages=history,
            system_prompt=system_prompt,
            stop_event=stop_event,
        ):
            if stop_event.is_set() or await redis.get(f"{key}:stop"):
                status = MessageStatus.STOPPED
                break
            full_content += token
            token_count += 1
            # rpush returns the new list length, so this token's index is
            # length - 1. The SSE endpoint uses it to skip tokens that were
            # already delivered in the catch-up payload.
            length = await redis.rpush(f"{key}:tokens", token)
            await redis.expire(f"{key}:tokens", GEN_TTL_SECONDS)
            await _publish(generation_id, "token", {"token": token, "index": length - 1})

        logger.info(
            "ollama_stream_finished",
            generation_id=generation_id,
            tokens=token_count,
            chars=len(full_content),
        )
        if status != MessageStatus.STOPPED:
            status = MessageStatus.COMPLETED

    except asyncio.CancelledError:
        status = MessageStatus.STOPPED
        logger.info("generation_cancelled", generation_id=generation_id)
    except Exception as e:
        status = MessageStatus.FAILED
        error_msg = str(e)
        logger.exception("generation_failed", generation_id=generation_id, error=str(e))
        await _publish(generation_id, "failed", {"message": error_msg or "Generation failed"})

    # Persist the final state. Wrapped so that a DB hiccup can never leave the
    # chat permanently locked — see the finally block below.
    try:
        async with AsyncSessionLocal() as session:
            try:
                result = await session.execute(
                    select(Message).where(Message.id == uuid.UUID(message_id))
                )
                msg = result.scalar_one_or_none()
                if msg:
                    msg.content = full_content
                    msg.status = status
                    msg.error_message = error_msg
                    msg.model_name = settings.OLLAMA_MODEL
                    msg.updated_at = datetime.now(timezone.utc)
                    await session.commit()

                if is_first_message and status == MessageStatus.COMPLETED and full_content:
                    try:
                        title = await ollama_service.generate_title(
                            user_message_content, full_content
                        )
                    except Exception:
                        title = (user_message_content[:48] + "…") if len(user_message_content) > 48 else user_message_content
                    await session.execute(
                        update(Chat)
                        .where(Chat.id == uuid.UUID(chat_id))
                        .values(
                            title=title,
                            is_title_generated=True,
                            updated_at=datetime.now(timezone.utc),
                        )
                    )
                    await session.commit()
                    await _publish(
                        generation_id, "title", {"title": title, "chat_id": chat_id}
                    )
            except Exception as e:
                logger.exception("db_update_failed", error=str(e))

        await redis.hset(
            key,
            mapping={
                "status": status.value,
                "content": full_content,
                "error": error_msg or "",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await redis.expire(key, GEN_TTL_SECONDS)

        event_name = "done"
        if status == MessageStatus.STOPPED:
            event_name = "stopped"
        elif status == MessageStatus.FAILED:
            event_name = "failed"
        await _publish(
            generation_id,
            event_name,
            {
                "status": status.value,
                "content": full_content,
                "error": error_msg,
                "message_id": message_id,
                "chat_id": chat_id,
            },
        )
    except Exception as e:
        logger.exception("generation_finalize_failed", error=str(e))
    finally:
        # Always release the per-chat lock and drop in-process bookkeeping,
        # whatever happened above.
        try:
            await clear_active_generation(chat_id)
        except Exception as e:
            logger.warning("clear_active_generation_failed", error=str(e))
        _stop_flags.pop(generation_id, None)
        _active_tasks.pop(generation_id, None)
        logger.info("run_generation_end", generation_id=generation_id, status=status.value)


def start_generation_task(
    generation_id: str,
    message_id: str,
    chat_id: str,
    history: List[Dict[str, str]],
    system_prompt: Optional[str] = None,
    is_first_message: bool = False,
    user_message_content: str = "",
):
    """Always start in-process asyncio task (reliable single-worker mode)."""
    task = asyncio.create_task(
        run_generation(
            generation_id=generation_id,
            message_id=message_id,
            chat_id=chat_id,
            history=history,
            system_prompt=system_prompt,
            is_first_message=is_first_message,
            user_message_content=user_message_content,
        )
    )
    _active_tasks[generation_id] = task
    logger.info("generation_task_created", generation_id=generation_id)
    return task
