import uuid
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.chat import Chat
from app.schemas.auth import Token, UserLogin, UserRegister, GuestSession
from app.schemas.user import UserOut
from app.api.v1.deps import get_current_user_optional, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token)
async def register(
    data: UserRegister,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_guest_id: Annotated[Optional[str], Header(alias="X-Guest-Id")] = None,
):
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        role=UserRole.USER,
        is_guest=False,
    )
    db.add(user)
    await db.flush()

    # Link any guest chats + track conversion
    if x_guest_id:
        guest_result = await db.execute(select(User).where(User.guest_id == x_guest_id))
        guest = guest_result.scalar_one_or_none()
        linked = await db.execute(
            Chat.__table__.update()
            .where(Chat.guest_id == x_guest_id)
            .values(user_id=user.id, guest_id=None)
        )
        if guest:
            guest.is_active = False
        try:
            from app.core.redis import get_redis
            redis = await get_redis()
            await redis.incr("stats:guest_conversions")
        except Exception:
            pass

    await db.commit()
    await db.refresh(user)

    token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value},
    )
    return Token(access_token=token)


@router.post("/login", response_model=Token)
async def login(
    data: UserLogin,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_guest_id: Annotated[Optional[str], Header(alias="X-Guest-Id")] = None,
):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    # Link guest chats on login
    if x_guest_id:
        result_chats = await db.execute(
            select(Chat).where(Chat.guest_id == x_guest_id)
        )
        guest_chats = result_chats.scalars().all()
        if guest_chats:
            await db.execute(
                Chat.__table__.update()
                .where(Chat.guest_id == x_guest_id)
                .values(user_id=user.id, guest_id=None)
            )
            try:
                from app.core.redis import get_redis
                redis = await get_redis()
                await redis.incr("stats:guest_conversions")
            except Exception:
                pass
        await db.commit()

    token = create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value},
    )
    return Token(access_token=token)


@router.post("/guest", response_model=GuestSession)
async def create_guest_session(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    guest_id = str(uuid.uuid4())
    user = User(
        guest_id=guest_id,
        role=UserRole.GUEST,
        is_guest=True,
        is_active=True,
        full_name="Guest",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Guests also get a short-lived token for convenience
    token = create_access_token(
        subject=str(user.id),
        expires_delta=timedelta(hours=24),
        extra_claims={"role": "guest", "guest_id": guest_id},
    )
    return GuestSession(guest_id=guest_id, access_token=token)


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_user)]):
    return user
