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
from app.api.v1.deps import user_from_token
from app.models.chat import Message, Chat
from app.models.user import User
from app.services.generation import get_generation_state, _gen_key
from app.services.ownership import owns_chat
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/stream", tags=["stream"])


async def _resolve_user(
    db: AsyncSession,
    token: Optional[str],
    guest_id: Optional[str],
) -> Optional[User]:
    if token:
        return await user_from_token(db, token)
    if guest_id:
        result = await db.execute(select(User).where(
            User.guest_id == guest_id, User.is_guest.is_(True), User.is_active.is_(True)
        ))
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
    user = await _resolve_user(db, token, guest_id)
    if not user:
        raise HTTPException(401, "Authentication required")
    result = await db.execute(
        select(Message, Chat).join(Chat, Message.chat_id == Chat.id)
        .where(Message.generation_id == generation_id)
    )
    row = result.one_or_none()
    if not row or not owns_chat(user, row[1]):
        raise HTTPException(404, "Generation not found")
    msg, chat = row
    redis = await get_redis()
    key = _gen_key(generation_id)

    state = await get_generation_state(generation_id)
    if not state:
        if msg.status.value in ("completed", "stopped", "failed"):

            async def finished():
                yield (
                    f"event: done\ndata: "
                    f"{json.dumps({'status': msg.status.value, 'content': msg.content, 'error': msg.error_message, 'message_id': str(msg.id)})}\n\n"
                )

            return StreamingResponse(finished(), media_type="text/event-stream")

    async def event_generator():
        # Subscribe BEFORE reading the snapshot. Sequence numbers discard
        # queued tokens already present in that snapshot.
        pubsub = redis.pubsub()
        channel = f"{key}:channel"
        await pubsub.subscribe(channel)
        try:
            current = await get_generation_state(generation_id)
            replayed = len((current or {}).get("tokens") or [])
            if current:
                yield f"event: catchup\ndata: {json.dumps({'content': current.get('content', ''), 'status': current.get('status')})}\n\n"
                if current.get("status") in ("completed", "stopped", "failed"):
                    yield f"event: done\ndata: {json.dumps({'status': current.get('status'), 'content': current.get('content', ''), 'error': current.get('error')})}\n\n"
                    return
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
                        if event == "token" and data.get("sequence", 0) <= replayed:
                            continue
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
                        if await redis.get(f"chat:{chat.id}:active_gen") != generation_id:
                            await db.refresh(msg)
                            terminal = msg.status.value if msg.status.value in ("completed", "stopped", "failed") else "failed"
                            yield f"event: done\ndata: {json.dumps({'status': terminal, 'content': (st or {}).get('content') or msg.content, 'error': msg.error_message or ('Generation interrupted. Please retry.' if terminal == 'failed' else None)})}\n\n"
                            break
                    await asyncio.sleep(0.05)
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
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
