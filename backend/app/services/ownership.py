"""Shared chat ownership rules for HTTP and streaming endpoints."""

from sqlalchemy import or_

from app.models.chat import Chat
from app.models.user import User


def chat_owner_filter(user: User):
    clauses = [Chat.user_id == user.id]
    if user.is_guest and user.guest_id:
        clauses.append(Chat.guest_id == user.guest_id)
    return or_(*clauses)


def owns_chat(user: User, chat: Chat) -> bool:
    return chat.user_id == user.id or bool(
        user.is_guest and user.guest_id and chat.guest_id == user.guest_id
    )
