"""
Server-Sent Events endpoint for generation progress.

Supports reconnect: replays tokens already produced, then livesubscribes via Redis.
EventSource cannot set Authorization headers, so we also accept ?token= & ?guest_id=
"""

import asyncio
import json
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis import get_redis
from app.core.security import decode_access_token
from app.models.chat import Message
from app.models.user import User
from app.services.generation import get_generation_state, _gen_key
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/stream", tags=["stream"])


async def _resolve_user(
    db: AsyncSession,
    token: Optional[str],
    guest_id: Optional[str],
) -> Optional[User]:
    if token:
        payload = decode_access_token(token)
        if payload and payload.get("sub"):
            try:
                result = await db.execute(
                    select(User).where(User.id == UUID(payload["sub"]))
                )
                user = result.scalar_one_or_none()
                if user and user.is_active:
                    return user
            except Exception:
                pass
    if guest_id:
        result = await db.execute(select(User).where(User.guest_id == guest_id))
        return result.scalar_one_or_none()
    return None


@router.get("/{generation_id}")
async def stream_generation(
    generation_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Optional[str] = Query(None),
    guest_id: Optional[str] = Query(None),
):
    redis = await get_redis()
    key = _gen_key(generation_id)

    # Optional auth via query (EventSource-friendly)
    await _resolve_user(db, token, guest_id)

    state = await get_generation_state(generation_id)
    if not state:
        result = await db.execute(
            select(Message).where(Message.generation_id == generation_id)
        )
        msg = result.scalar_one_or_none()
        if not msg:
            raise HTTPException(404, "Generation not found")
        if msg.status.value in ("completed", "stopped", "failed"):

            async def finished():
                yield (
                    f"event: done\ndata: "
                    f"{json.dumps({'status': msg.status.value, 'content': msg.content, 'error': msg.error_message, 'message_id': str(msg.id)})}\n\n"
                )

            return StreamingResponse(finished(), media_type="text/event-stream")

    async def event_generator():
        # 1. Replay
        current = state or (await get_generation_state(generation_id))
        if current:
            tokens = current.get("tokens") or []
            if tokens:
                yield f"event: catchup\ndata: {json.dumps({'content': ''.join(tokens), 'status': current.get('status')})}\n\n"
            status = current.get("status")
            if status in ("completed", "stopped", "failed"):
                yield f"event: done\ndata: {json.dumps({'status': status, 'content': current.get('content', ''), 'error': current.get('error')})}\n\n"
                return

        # 2. Live Redis pub/sub
        pubsub = redis.pubsub()
        channel = f"{key}:channel"
        await pubsub.subscribe(channel)
        try:
            idle_ticks = 0
            while True:
                if await request.is_disconnected():
                    logger.info("client_disconnected", generation_id=generation_id)
                    break

                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if message and message["type"] == "message":
                    idle_ticks = 0
                    raw = message["data"]
                    try:
                        payload = json.loads(raw)
                        event = payload.get("event", "message")
                        data = payload.get("data", {})
                        yield f"event: {event}\ndata: {json.dumps(data)}\n\n"
                        if event in ("done", "stopped", "failed", "error"):
                            break
                    except Exception:
                        continue
                else:
                    idle_ticks += 1
                    # Heartbeat keeps proxies from closing the connection
                    yield ": heartbeat\n\n"
                    # Safety: if Redis state says finished but we missed the event
                    if idle_ticks % 5 == 0:
                        st = await get_generation_state(generation_id)
                        if st and st.get("status") in (
                            "completed",
                            "stopped",
                            "failed",
                        ):
                            yield f"event: done\ndata: {json.dumps({'status': st.get('status'), 'content': st.get('content', ''), 'error': st.get('error')})}\n\n"
                            break
                    await asyncio.sleep(0.05)
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
