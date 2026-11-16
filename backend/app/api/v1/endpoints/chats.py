import uuid
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from sqlalchemy import select, desc, func, or_
from sqlalchemy.orm.attributes import flag_modified
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
    RegenerateMessageRequest,
)
from app.api.v1.deps import (
    get_current_user_optional,
    get_current_user,
    require_login_for_second_message,
)
from app.services.usage import enforce_usage, get_usage
from app.services.generation import (
    is_generation_active,
    set_active_generation,
    start_generation_task,
    request_stop,
    get_generation_state,
)
from app.services.llm.ollama import ollama_service
from app.services.answering import prepare_answer, suggest_title
from app.services.ownership import chat_owner_filter, owns_chat
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
        is_pinned=bool(getattr(chat, "is_pinned", False)),
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
    q: Optional[str] = Query(None, max_length=200, description="Search titles and message text"),
    limit: int = Query(50, ge=1, le=100),
):
    if not user:
        return []

    query = (
        select(Chat)
        .where(chat_owner_filter(user))
        .order_by(desc(Chat.is_pinned), desc(Chat.updated_at))
        .limit(limit)
    )

    term = (q or "").strip()
    if term:
        # Match the typed text literally: % and _ are not wildcards here.
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        in_messages = (
            select(Message.id)
            .where(Message.chat_id == Chat.id, Message.content.ilike(pattern, escape="\\"))
            .exists()
        )
        query = query.where(or_(Chat.title.ilike(pattern, escape="\\"), in_messages))

    result = await db.execute(query)
    chats = result.scalars().all()

    items = []
    for c in chats:
        items.append(
            ChatListItem(
                id=c.id,
                title=c.title,
                is_title_generated=c.is_title_generated,
                is_pinned=bool(c.is_pinned),
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
    return _chat_out(chat)


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
    if not user:
        raise HTTPException(401, "Auth required")
    if not owns_chat(user, chat):
        raise HTTPException(403, "Not your chat")

    return chat


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    chat_id: UUID,
    data: ChatUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(select(Chat).options(selectinload(Chat.messages)).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat or not owns_chat(user, chat):
        raise HTTPException(404, "Chat not found")
    if data.title is not None:
        chat.title = data.title
        chat.is_title_generated = True
    elif data.is_pinned is not None:
        # Pinning is not activity: keep the last-updated time as it was.
        flag_modified(chat, "updated_at")
    if data.is_pinned is not None:
        chat.is_pinned = data.is_pinned
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
    if not chat or not owns_chat(user, chat):
        raise HTTPException(404, "Chat not found")
    active_messages = await db.execute(select(Message).where(
        Message.chat_id == chat.id,
        Message.status.in_([MessageStatus.PENDING, MessageStatus.THINKING, MessageStatus.STREAMING]),
    ))
    for message in active_messages.scalars():
        if message.generation_id:
            await request_stop(message.generation_id)
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
        if not owns_chat(user, chat):
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

    generation_id = str(uuid.uuid4())
    if not await set_active_generation(str(chat.id), generation_id):
        raise HTTPException(409, "Generation already in progress")
    try:
        await enforce_usage(db, user)
    except BaseException:
        from app.services.generation import clear_active_generation
        await clear_active_generation(str(chat.id), generation_id)
        raise

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
    chat.updated_at = user_msg.created_at
    try:
        await db.commit()
    except BaseException:
        from app.services.generation import clear_active_generation
        await clear_active_generation(str(chat.id), generation_id)
        raise
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
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(max(2, settings.MAX_HISTORY_MESSAGES))
    )
    prior = list(reversed(hist_result.scalars().all()))
    history = []
    for m in prior:
        if not m.content or (m.role == MessageRole.ASSISTANT and m.status != MessageStatus.COMPLETED):
            continue
        role = m.role.value if hasattr(m.role, "value") else str(m.role)
        if role in ("user", "assistant", "system"):
            history.append({"role": role, "content": m.content})
    if not any(h.get("content") == data.content and h.get("role") == "user" for h in history[-1:]):
        # ensure latest user turn present
        if not history or history[-1].get("content") != data.content:
            history.append({"role": "user", "content": data.content})

    is_first = not chat.is_title_generated

    system_prompt, hits = await prepare_answer(data.content, data.persona)

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
        if not chat.is_title_generated:
            chat.title = suggest_title(data.content)
            chat.is_title_generated = True
        await db.commit()
        await db.refresh(assistant_msg)
        await clear_active_generation(str(chat.id), generation_id)
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
    chat_result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = chat_result.scalar_one_or_none()
    if not chat or not owns_chat(user, chat):
        raise HTTPException(404, "Chat not found")
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
    data: Optional[RegenerateMessageRequest] = None,
):
    """Regenerate the last assistant response (or a specific one)."""
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat or not owns_chat(user, chat):
        raise HTTPException(404, "Chat not found")

    # Find the target assistant message
    target = None
    for m in chat.messages:
        if m.id == message_id and m.role == MessageRole.ASSISTANT:
            target = m
            break
    if not target:
        raise HTTPException(404, "Assistant message not found")
    if user.is_guest and target.status != MessageStatus.FAILED:
        raise HTTPException(403, "Please login to regenerate this response")
    if target.id != chat.messages[-1].id:
        raise HTTPException(400, "Only the latest assistant response can be regenerated")

    # Find the preceding user message by position: timestamps can tie.
    position = next(i for i, m in enumerate(chat.messages) if m.id == target.id)
    user_content = next(
        (m.content for m in reversed(chat.messages[:position]) if m.role == MessageRole.USER), ""
    )
    if not user_content:
        raise HTTPException(400, "No preceding user message")

    generation_id = str(uuid.uuid4())
    if not await set_active_generation(str(chat.id), generation_id):
        raise HTTPException(409, "Generation already in progress")

    # Usage
    try:
        await enforce_usage(db, user)
    except BaseException:
        from app.services.generation import clear_active_generation
        await clear_active_generation(str(chat.id), generation_id)
        raise

    # Reset the message
    target.content = ""
    target.status = MessageStatus.THINKING
    target.generation_id = generation_id
    target.error_message = None
    try:
        await db.commit()
    except BaseException:
        from app.services.generation import clear_active_generation
        await clear_active_generation(str(chat.id), generation_id)
        raise
    await db.refresh(target)

    # History up to (but not including) the target
    history = []
    for m in chat.messages:
        if m.id == target.id:
            break
        if m.content and (m.role != MessageRole.ASSISTANT or m.status == MessageStatus.COMPLETED):
            history.append({"role": m.role.value, "content": m.content})

    system_prompt, _ = await prepare_answer(user_content, data.persona if data else None)

    start_generation_task(
        generation_id=generation_id,
        message_id=str(target.id),
        chat_id=str(chat.id),
        history=history,
        system_prompt=system_prompt,
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
