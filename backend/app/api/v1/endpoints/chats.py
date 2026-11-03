import uuid
from datetime import datetime, timezone
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.chat import Chat, Message, MessageRole, MessageStatus
from app.schemas.chat import (
    ChatOut,
    ChatListItem,
    ChatCreate,
    ChatUpdate,
    MessageOut,
    SendMessageRequest,
    SendMessageResponse,
)
from app.api.v1.deps import (
    get_current_user_optional,
    get_current_user,
    require_login_for_second_message,
)
from app.services.usage import check_and_increment_usage, get_usage
from app.services.generation import (
    is_generation_active,
    set_active_generation,
    start_generation_task,
    request_stop,
    get_generation_state,
    clear_active_generation,
)
from app.services.llm.ollama import ollama_service
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/chats", tags=["chats"])

def _chat_out(chat) -> ChatOut:
    return ChatOut(
        id=chat.id,
        title=chat.title or "New Chat",
        user_id=chat.user_id,
        guest_id=chat.guest_id,
        is_title_generated=bool(getattr(chat, "is_title_generated", False)),
        channel=getattr(chat, "channel", None) or "web",
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=[],
    )

@router.get("/personas")
async def list_personas():
    from app.services.personas import PERSONAS

    return {
        "personas": [
            {"id": key, "label": val["label"]} for key, val in PERSONAS.items()
        ]
    }


@router.get("", response_model=List[ChatListItem])
async def list_chats(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[Optional[User], Depends(get_current_user_optional)],
    q: Optional[str] = Query(None, description="Search title"),
    limit: int = Query(50, le=100),
):
    if not user:
        return []

    query = select(Chat).where(
        (Chat.user_id == user.id) | (Chat.guest_id == user.guest_id)
    ).order_by(desc(Chat.updated_at)).limit(limit)

    if q:
        query = query.where(Chat.title.ilike(f"%{q}%"))

    result = await db.execute(query)
    chats = result.scalars().all()

    items = []
    for c in chats:
        items.append(
            ChatListItem(
                id=c.id,
                title=c.title,
                is_title_generated=c.is_title_generated,
                updated_at=c.updated_at,
            )
        )
    return items


@router.post("", response_model=ChatOut)
async def create_chat(
    data: ChatCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[Optional[User], Depends(get_current_user_optional)],
):
    if not user:
        raise HTTPException(401, "Authentication or guest session required")

    chat = Chat(
        user_id=user.id if not user.is_guest else None,
        guest_id=user.guest_id if user.is_guest else None,
        title=data.title or "New Chat",
        channel=data.channel or "web",
    )
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return chat


@router.get("/{chat_id}", response_model=ChatOut)
async def get_chat(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[Optional[User], Depends(get_current_user_optional)],
):
    result = await db.execute(
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Ownership check
    if user:
        if chat.user_id and chat.user_id != user.id:
            if not (user.is_guest and chat.guest_id == user.guest_id):
                raise HTTPException(403, "Not your chat")
        if chat.guest_id and user.guest_id != chat.guest_id and chat.user_id != user.id:
            raise HTTPException(403, "Not your chat")
    else:
        raise HTTPException(401, "Auth required")

    return chat


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    chat_id: UUID,
    data: ChatUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat or (chat.user_id != user.id and chat.guest_id != user.guest_id):
        raise HTTPException(404, "Chat not found")
    if data.title is not None:
        chat.title = data.title
        chat.is_title_generated = True
    await db.commit()
    await db.refresh(chat)
    return chat


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat or (chat.user_id != user.id and chat.guest_id != user.guest_id):
        raise HTTPException(404, "Chat not found")
    await db.delete(chat)
    await db.commit()


@router.post("/send", response_model=SendMessageResponse)
async def send_message(
    data: SendMessageRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_login_for_second_message)],
):
    """
    Core endpoint:
    - Enforces one active generation per chat
    - Enforces daily + rate limits
    - Creates user + assistant messages
    - Starts background generation task
    - Returns immediately so the UI can start listening to the stream
    """
    # Usage limits
    allowed, used, limit, msg = await check_and_increment_usage(db, user)
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    # Resolve or create chat
    chat: Optional[Chat] = None
    if data.chat_id:
        result = await db.execute(
            select(Chat)
            .options(selectinload(Chat.messages))
            .where(Chat.id == data.chat_id)
        )
        chat = result.scalar_one_or_none()
        if not chat:
            raise HTTPException(404, "Chat not found")
        if chat.user_id != user.id and chat.guest_id != user.guest_id:
            raise HTTPException(403, "Not your chat")
    else:
        chat = Chat(
            user_id=user.id if not user.is_guest else None,
            guest_id=user.guest_id if user.is_guest else None,
            title="New Chat",
            channel="web",
        )
        db.add(chat)
        await db.flush()

    # One message at a time per chat: reject the new send instead of
    # starting a second competing generation task on the same chat.
    if await is_generation_active(str(chat.id)):
        raise HTTPException(
            status_code=409,
            detail="Энэ чат дээр хариу үүсэж байна. Дуусахыг хүлээнэ үү.",
        )

    # Create user message
    user_msg = Message(
        chat_id=chat.id,
        role=MessageRole.USER,
        content=data.content,
        status=MessageStatus.COMPLETED,
    )
    db.add(user_msg)
    await db.flush()

    # Create placeholder assistant message
    generation_id = str(uuid.uuid4())
    assistant_msg = Message(
        chat_id=chat.id,
        role=MessageRole.ASSISTANT,
        content="",
        status=MessageStatus.THINKING,
        generation_id=generation_id,
        model_name=settings.OLLAMA_MODEL,
    )
    db.add(assistant_msg)
    await db.flush()

    # Mark chat as having active generation
    await set_active_generation(str(chat.id), generation_id)
    # A freshly flushed user_msg may not have created_at populated yet.
    chat.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(assistant_msg)
    await db.refresh(chat)

    # Re-load history AFTER commit (async session expires relationships)
    hist_result = await db.execute(
        select(Message)
        .where(
            Message.chat_id == chat.id,
            Message.id != assistant_msg.id,
        )
        .order_by(Message.created_at.asc())
    )
    prior = hist_result.scalars().all()
    history = []
    for m in prior:
        if not m.content:
            continue
        role = m.role.value if hasattr(m.role, "value") else str(m.role)
        if role in ("user", "assistant", "system"):
            history.append({"role": role, "content": m.content})
    if not any(h.get("content") == data.content and h.get("role") == "user" for h in history[-1:]):
        # ensure latest user turn present
        if not history or history[-1].get("content") != data.content:
            history.append({"role": "user", "content": data.content})

    user_count = sum(1 for m in prior if m.role == MessageRole.USER)
    is_first = user_count <= 1

    hits = []
    rag_block = ""
    try:
        from app.services.rag.pipeline import query_knowledge, build_rag_context
        import asyncio as _aio

        hits = await _aio.wait_for(
            query_knowledge(data.content, top_k=settings.RAG_TOP_K),
            timeout=5.0,
        )
        rag_block = build_rag_context(hits)
    except Exception:
        hits = []
        rag_block = ""

    # 2) FAQ таарвал LLMгүйгээр хариу
    direct = None
    try:
        from app.services.rag.pipeline import extract_faq_answer
        direct = extract_faq_answer(hits or [], data.content)
    except Exception:
        direct = None

    if direct:
        import structlog as _slog
        from app.services.generation import _publish, clear_active_generation

        assistant_msg.content = direct
        assistant_msg.status = MessageStatus.COMPLETED
        assistant_msg.model_name = "rag-direct"
        await db.commit()
        await db.refresh(assistant_msg)
        await clear_active_generation(str(chat.id))
        try:
            await _publish(generation_id, "token", {"token": direct})
            await _publish(
                generation_id,
                "done",
                {"message_id": str(assistant_msg.id), "content": direct},
            )
        except Exception as e:
            _slog.get_logger().warning("rag_direct_publish_failed", error=str(e))
        _slog.get_logger().info(
            "rag_direct_reply", query=data.content[:80], answer=direct[:80]
        )
        usage = await get_usage(user)
        return SendMessageResponse(
            chat=ChatOut(
                id=chat.id,
                title=chat.title or "New Chat",
                user_id=chat.user_id,
                guest_id=chat.guest_id,
                is_title_generated=bool(chat.is_title_generated),
                channel=chat.channel or "web",
                created_at=chat.created_at,
                updated_at=chat.updated_at,
                messages=[],
            ),
            user_message=MessageOut.model_validate(user_msg),
            assistant_message=MessageOut.model_validate(assistant_msg),
            usage=usage,
        )

    from app.services.personas import persona_system_addon

    persona_extra = persona_system_addon(data.persona)
    system_prompt = (
        "You are the official NKMZ Chat assistant. "
        "Answer in the same language the user writes in (Mongolian or English). "
        "Be warm, clear, and concise. "
        "If unsure, say you do not know. Never invent prices, hours, or phone numbers. "
        "No chain-of-thought; give the final answer only."
    )
    if persona_extra:
        system_prompt = f"{system_prompt}\n\n{persona_extra}"

    if rag_block and history:
        last = dict(history[-1])
        q = last.get("content") or data.content
        last["content"] = (
            "[KNOWLEDGE BASE]\n"
            + rag_block
            + "\n\n[QUESTION]\n"
            + q
            + "\n\n[INSTRUCTIONS]\n"
            "Answer using the knowledge base for company facts. "
            "«Цагийн хуваарь» / «ажлын цаг» = working hours (e.g. 09:00–18:00), "
            "NOT timezone (UTC+8). "
            "Copy numbers exactly. If not in the knowledge base, say you don't have that info."
        )
        history = history[:-1] + [last]
        system_prompt = (
            "You are the official NKMZ Chat assistant. "
            "Priority: KNOWLEDGE BASE in the user message over general knowledge. "
            "For hours, prices, phone, address, policies — use ONLY the knowledge base. "
            "«Цагийн хуваарь» means working hours, never a timezone. "
            "Be concise. Answer in the user's language. No chain-of-thought."
        )

    # Start background generation (always in-process; never silently queue)
    import structlog as _slog

    _slog.get_logger().info(
        "starting_generation",
        generation_id=generation_id,
        chat_id=str(chat.id),
        history_len=len(history),
    )
    task = start_generation_task(
        generation_id=generation_id,
        message_id=str(assistant_msg.id),
        chat_id=str(chat.id),
        history=history,
        system_prompt=system_prompt,
        is_first_message=is_first,
        user_message_content=data.content,
    )

    def _on_task_done(t):
        try:
            exc = t.exception()
            if exc:
                _slog.get_logger().error(
                    "generation_task_crashed",
                    generation_id=generation_id,
                    error=str(exc),
                )
        except Exception:
            pass

    try:
        task.add_done_callback(_on_task_done)
    except Exception:
        pass

    usage = await get_usage(user)

    return SendMessageResponse(
        chat=ChatOut(
            id=chat.id,
            title=chat.title or "New Chat",
            user_id=chat.user_id,
            guest_id=chat.guest_id,
            is_title_generated=bool(chat.is_title_generated),
            channel=chat.channel or "web",
            created_at=chat.created_at,
            updated_at=chat.updated_at,
            messages=[],
        ),
        user_message=MessageOut.model_validate(user_msg),
        assistant_message=MessageOut.model_validate(assistant_msg),
        usage=usage,
    )

@router.post("/{chat_id}/messages/{message_id}/stop")
async def stop_generation(
    chat_id: UUID,
    message_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(select(Message).where(Message.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg or msg.chat_id != chat_id:
        raise HTTPException(404, "Message not found")
    if not msg.generation_id:
        raise HTTPException(400, "No active generation")
    await request_stop(msg.generation_id)
    return {"status": "stop_requested", "generation_id": msg.generation_id}


@router.post("/{chat_id}/messages/{message_id}/regenerate", response_model=SendMessageResponse)
async def regenerate(
    chat_id: UUID,
    message_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Regenerate the last assistant response (or a specific one)."""
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat or (chat.user_id != user.id and chat.guest_id != user.guest_id):
        raise HTTPException(404, "Chat not found")

    if await is_generation_active(str(chat.id)):
        raise HTTPException(
            status_code=409,
            detail="Энэ чат дээр хариу үүсэж байна. Дуусахыг хүлээнэ үү.",
        )

    # Find the target assistant message
    target = None
    for m in sorted(chat.messages, key=lambda x: x.created_at):
        if m.id == message_id:
            target = m
            break
    if not target or target.role != MessageRole.ASSISTANT:
        raise HTTPException(404, "Assistant message not found")

    # Find the user message that produced it
    user_content = ""
    ordered = sorted(chat.messages, key=lambda x: x.created_at)
    for i, m in enumerate(ordered):
        if m.id == target.id:
            for prev in reversed(ordered[:i]):
                if prev.role == MessageRole.USER:
                    user_content = prev.content
                    break
            break

    generation_id = str(uuid.uuid4())
    target.content = ""
    target.status = MessageStatus.THINKING
    target.generation_id = generation_id
    target.error_message = None
    await set_active_generation(str(chat.id), generation_id)

    # History up to (but not including) the target
    history = []
    for m in chat.messages:
        if m.id == target.id:
            break
        history.append({"role": m.role.value, "content": m.content})

    start_generation_task(
        generation_id=generation_id,
        message_id=str(target.id),
        chat_id=str(chat.id),
        history=history,
        is_first_message=False,
        user_message_content=user_content,
    )

    usage = await get_usage(user)
    return SendMessageResponse(
        chat=ChatOut.model_validate(chat),
        user_message=MessageOut(
            id=uuid.uuid4(),  # placeholder, not used
            chat_id=chat.id,
            role=MessageRole.USER,
            content=user_content,
            status=MessageStatus.COMPLETED,
            created_at=target.created_at,
            updated_at=target.updated_at,
        ),
        assistant_message=MessageOut.model_validate(target),
        usage=usage,
    )


@router.get("/usage/me")
async def my_usage(
    user: Annotated[User, Depends(get_current_user)],
):
    return await get_usage(user)
