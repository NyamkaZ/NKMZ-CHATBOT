from typing import Optional, Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status, Header, Cookie, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.core.config import settings
from app.models.user import User, UserRole
from app.schemas.user import UserOut

security = HTTPBearer(auto_error=False)


async def user_from_token(db: AsyncSession, token: str) -> Optional[User]:
    """The active user a bearer token belongs to, or None if it is no longer valid."""
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return None
    try:
        user_id = UUID(payload["sub"])
        version = int(payload.get("ver", 0))
    except (ValueError, TypeError, AttributeError):
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    # Tokens issued before a password change carry an older version.
    if version != (user.token_version or 0):
        return None
    return user


async def user_from_token(db: AsyncSession, token: str) -> Optional[User]:
    """The active user a bearer token belongs to, or None if it is no longer valid."""
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return None
    try:
        user_id = UUID(payload["sub"])
        version = int(payload.get("ver", 0))
    except (ValueError, TypeError, AttributeError):
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    # Tokens issued before a password change carry an older version.
    if version != (user.token_version or 0):
        return None
    return user


async def get_current_user_optional(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
    x_guest_id: Annotated[Optional[str], Header(alias="X-Guest-Id")] = None,
) -> Optional[User]:
    """Return authenticated user or guest user if present."""
    if credentials:
        return await user_from_token(db, credentials.credentials)

    if x_guest_id:
        result = await db.execute(select(User).where(
            User.guest_id == x_guest_id, User.is_guest.is_(True), User.is_active.is_(True)
        ))
        guest = result.scalar_one_or_none()
        if guest:
            return guest

    return None


async def get_current_user(
    user: Annotated[Optional[User], Depends(get_current_user_optional)],
) -> User:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_active_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


async def get_admin_user(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


async def require_login_for_second_message(
    user: Annotated[Optional[User], Depends(get_current_user_optional)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    Guests may send only the first message.
    After that, login is required.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Please login to continue chatting")

    if user.is_guest or user.role == UserRole.GUEST:
        # Serialize guest sends across different conversations as well.
        await db.execute(select(User).where(User.id == user.id).with_for_update())
        # Count total messages sent by this guest
        from app.models.chat import Message, Chat, MessageRole
        from app.services.ownership import chat_owner_filter
        from sqlalchemy import func

        result = await db.execute(
            select(func.count(Message.id))
            .join(Chat, Message.chat_id == Chat.id)
            .where(
                chat_owner_filter(user),
                Message.role == MessageRole.USER,
            )
        )
        msg_count = result.scalar() or 0
        if msg_count >= settings.GUEST_MESSAGE_LIMIT:
            raise HTTPException(
                status_code=403,
                detail="Guest limit reached. Please login or register to continue.",
            )
    return user
