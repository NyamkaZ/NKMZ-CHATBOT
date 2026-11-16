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
from app.services.answering import suggest_title

logger = structlog.get_logger()

_stop_flags: Dict[str, asyncio.Event] = {}
_active_tasks: Dict[str, asyncio.Task] = {}
# Generations that must not be cancelled (again): either a stop was already
# delivered or the final answer is being saved. A second CancelledError would
# land inside the save and discard the partial answer.
_cancel_closed: set[str] = set()


def _cancel_once(generation_id: str, task: Optional[asyncio.Task]) -> None:
    if task is None or generation_id in _cancel_closed:
        return
    _cancel_closed.add(generation_id)
    task.cancel()


def _gen_key(generation_id: str) -> str:
    return f"gen:{generation_id}"


async def is_generation_active(chat_id: str) -> bool:
    redis = await get_redis()
    return bool(await redis.get(f"chat:{chat_id}:active_gen"))


async def set_active_generation(chat_id: str, generation_id: str, ttl: int = 900):
    redis = await get_redis()
    return bool(await redis.set(f"chat:{chat_id}:active_gen", generation_id, ex=ttl, nx=True))


async def clear_active_generation(chat_id: str, generation_id: str):
    redis = await get_redis()
    await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
        "return redis.call('del', KEYS[1]) else return 0 end",
        1, f"chat:{chat_id}:active_gen", generation_id,
    )


async def request_stop(generation_id: str) -> bool:
    redis = await get_redis()
    await redis.set(f"{_gen_key(generation_id)}:stop", "1", ex=120)
    if generation_id in _stop_flags:
        _stop_flags[generation_id].set()
    if not settings.USE_GENERATION_WORKER:
        _cancel_once(generation_id, _active_tasks.get(generation_id))
    return True


async def get_generation_state(generation_id: str) -> Optional[Dict[str, Any]]:
    redis = await get_redis()
    raw = await redis.hgetall(_gen_key(generation_id))
    if not raw:
        return None
    # decode bytes keys/values from redis
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
    await redis.set(f"{_gen_key(generation_id)}:last", payload, ex=900)


async def recover_interrupted_generations():
    """Recover abandoned jobs when the single-process backend starts again."""
    redis = await get_redis()
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Message).where(Message.status.in_(
            [MessageStatus.PENDING, MessageStatus.THINKING, MessageStatus.STREAMING]
        )))
        for message in result.scalars():
            if not message.generation_id:
                continue
            state = await get_generation_state(message.generation_id)
            message.content = (state or {}).get("content") or message.content
            message.status = MessageStatus.FAILED
            message.error_message = "Generation interrupted by a server restart. Please retry."
            await redis.hset(_gen_key(message.generation_id), mapping={
                "status": "failed", "content": message.content, "error": message.error_message,
            })
            await redis.expire(_gen_key(message.generation_id), 900)
            await clear_active_generation(str(message.chat_id), message.generation_id)
            await _publish(message.generation_id, "done", {
                "status": "failed", "content": message.content, "error": message.error_message,
            })
        await session.commit()


async def _run_generation(
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
    await redis.expire(key, 900)
    await _publish(generation_id, "thinking", {"message": "Thinking..."})

    full_content = ""
    status = MessageStatus.FAILED
    error_msg = None
    metrics = {}

    try:
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
            metrics=metrics,
        ):
            if stop_event.is_set() or await redis.get(f"{key}:stop"):
                status = MessageStatus.STOPPED
                break
            full_content += token
            token_count += 1
            await redis.rpush(f"{key}:tokens", token)
            await redis.expire(f"{key}:tokens", 900)
            await redis.expire(f"chat:{chat_id}:active_gen", 900)
            await _publish(generation_id, "token", {"token": token, "sequence": token_count})

        logger.info(
            "ollama_stream_finished",
            generation_id=generation_id,
            tokens=token_count,
            chars=len(full_content),
        )
        if stop_event.is_set() or await redis.get(f"{key}:stop"):
            status = MessageStatus.STOPPED
        elif status != MessageStatus.STOPPED:
            status = MessageStatus.COMPLETED

    except asyncio.CancelledError:
        status = MessageStatus.STOPPED
        logger.info("generation_cancelled", generation_id=generation_id)
    except Exception as e:
        status = MessageStatus.FAILED
        error_msg = str(e)
        logger.exception("generation_failed", generation_id=generation_id, error=str(e))

    # Persist final state. From here on a late stop request has nothing left to
    # interrupt, so it must not cancel the save.
    _cancel_closed.add(generation_id)
    async with AsyncSessionLocal() as session:
        try:
            result = await session.execute(
                select(Message).where(Message.id == uuid.UUID(message_id), Message.generation_id == generation_id)
            )
            msg = result.scalar_one_or_none()
            if msg:
                msg.content = full_content
                msg.status = status
                msg.error_message = error_msg
                msg.model_name = settings.OLLAMA_MODEL
                msg.token_count = metrics.get("output_tokens")
                msg.prompt_tokens = metrics.get("prompt_tokens")
                msg.duration_ms = metrics.get("total_ms")
                msg.updated_at = datetime.now(timezone.utc)
                await session.commit()

            if is_first_message and status == MessageStatus.COMPLETED and full_content:
                title = suggest_title(user_message_content)
                await session.execute(
                    update(Chat)
                    .where(Chat.id == uuid.UUID(chat_id), Chat.is_title_generated.is_(False))
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
            "metrics": json.dumps(metrics),
        },
    )
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
            "metrics": metrics,
        },
    )

    logger.info("run_generation_end", generation_id=generation_id, status=status.value)


async def run_generation(generation_id: str, message_id: str, chat_id: str, **kwargs):
    current_task = asyncio.current_task()

    async def watch_for_stop():
        try:
            redis = await get_redis()
            while True:
                if await redis.get(f"{_gen_key(generation_id)}:stop"):
                    _cancel_once(generation_id, current_task)
                    return
                await asyncio.sleep(0.25)
        except Exception:
            logger.warning("generation_stop_monitor_failed", generation_id=generation_id)

    stop_monitor = asyncio.create_task(watch_for_stop())
    try:
        await _run_generation(generation_id, message_id, chat_id, **kwargs)
    except BaseException as exc:
        # Initialization and finalization can fail too (e.g. Redis restarts).
        # Always release this job's lock and leave a terminal DB status.
        status = MessageStatus.STOPPED if isinstance(exc, asyncio.CancelledError) else MessageStatus.FAILED
        logger.exception("generation_job_failed", generation_id=generation_id)
        try:
            async with AsyncSessionLocal() as session:
                await session.execute(update(Message).where(
                    Message.id == uuid.UUID(message_id), Message.generation_id == generation_id
                ).values(status=status, error_message="Generation interrupted. Please retry."))
                await session.commit()
        except Exception:
            logger.exception("generation_failure_persist_failed", generation_id=generation_id)
        try:
            redis = await get_redis()
            await redis.hset(_gen_key(generation_id), mapping={
                "status": status.value, "error": "Generation interrupted. Please retry."
            })
            await redis.expire(_gen_key(generation_id), 900)
            await _publish(generation_id, "done", {
                "status": status.value, "error": "Generation interrupted. Please retry."
            })
        except Exception:
            logger.exception("generation_failure_publish_failed", generation_id=generation_id)
    finally:
        stop_monitor.cancel()
        await asyncio.gather(stop_monitor, return_exceptions=True)
        _stop_flags.pop(generation_id, None)
        _active_tasks.pop(generation_id, None)
        _cancel_closed.discard(generation_id)
        try:
            await clear_active_generation(chat_id, generation_id)
        except Exception:
            logger.exception("generation_lock_release_failed", generation_id=generation_id)


def start_generation_task(
    generation_id: str,
    message_id: str,
    chat_id: str,
    history: List[Dict[str, str]],
    system_prompt: Optional[str] = None,
    is_first_message: bool = False,
    user_message_content: str = "",
):
    """Dispatch locally or to the optional dedicated generation worker."""
    kwargs = dict(
        generation_id=generation_id, message_id=message_id, chat_id=chat_id,
        history=history, system_prompt=system_prompt, is_first_message=is_first_message,
        user_message_content=user_message_content,
    )
    async def dispatch():
        if settings.USE_GENERATION_WORKER:
            try:
                redis = await get_redis()
                await redis.rpush("gen:queue", json.dumps(kwargs))
            except Exception:
                await clear_active_generation(chat_id, generation_id)
                raise
            finally:
                _active_tasks.pop(generation_id, None)
        else:
            await run_generation(**kwargs)

    task = asyncio.create_task(
        dispatch()
    )
    _active_tasks[generation_id] = task
    logger.info("generation_task_created", generation_id=generation_id)
    return task
