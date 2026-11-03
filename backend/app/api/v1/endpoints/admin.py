from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.core.database import get_db
from app.core.config import settings
from app.core.redis import get_redis
from app.models.user import User, UserRole
from app.models.chat import Chat, Message
from app.schemas.admin import (
    SystemStatus,
    ModelHealth,
    AnalyticsSummary,
    UsageLimitUpdate,
    UserAdminOut,
)
from app.api.v1.deps import get_admin_user
from app.services.llm.ollama import ollama_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/status", response_model=SystemStatus)
async def system_status(
    admin: Annotated[User, Depends(get_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Postgres
    try:
        await db.execute(select(1))
        pg = "ok"
    except Exception as e:
        pg = f"error: {e}"

    # Redis
    try:
        redis = await get_redis()
        await redis.ping()
        rd = "ok"
    except Exception as e:
        rd = f"error: {e}"

    # Ollama
    health = await ollama_service.health_check()
    ol = "ok" if health.get("available") else f"error: {health.get('error')}"

    return SystemStatus(
        status="ok" if pg == "ok" and rd == "ok" and ol == "ok" else "degraded",
        postgres=pg,
        redis=rd,
        ollama=ol,
        ollama_model=settings.OLLAMA_MODEL,
    )


@router.get("/models", response_model=List[ModelHealth])
async def models_health(admin: Annotated[User, Depends(get_admin_user)]):
    health = await ollama_service.health_check()
    models = []
    if health.get("available"):
        for name in health.get("models", []):
            models.append(
                ModelHealth(
                    name=name,
                    available=True,
                    details={"current": name == settings.OLLAMA_MODEL or settings.OLLAMA_MODEL in name},
                )
            )
    else:
        models.append(ModelHealth(name=settings.OLLAMA_MODEL, available=False, details=health))
    return models


@router.get("/analytics", response_model=AnalyticsSummary)
async def analytics(
    admin: Annotated[User, Depends(get_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from datetime import datetime, timezone

    total_users = (
        await db.execute(select(func.count(User.id)).where(User.is_guest == False))
    ).scalar() or 0
    total_chats = (await db.execute(select(func.count(Chat.id)))).scalar() or 0
    total_messages = (await db.execute(select(func.count(Message.id)))).scalar() or 0

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    messages_today = (
        await db.execute(
            select(func.count(Message.id)).where(
                Message.created_at >= today, Message.role == "user"
            )
        )
    ).scalar() or 0

    # Active users today = distinct users who sent a message today
    active_users_today = (
        await db.execute(
            select(func.count(func.distinct(Chat.user_id)))
            .select_from(Message)
            .join(Chat, Message.chat_id == Chat.id)
            .where(
                Message.created_at >= today,
                Message.role == "user",
                Chat.user_id.isnot(None),
            )
        )
    ).scalar() or 0

    guest_conversions = 0
    try:
        redis = await get_redis()
        guest_conversions = int(await redis.get("stats:guest_conversions") or 0)
    except Exception:
        pass

    return AnalyticsSummary(
        total_users=total_users,
        active_users_today=active_users_today,
        total_chats=total_chats,
        total_messages=total_messages,
        messages_today=messages_today,
        guest_conversions=guest_conversions,
    )


@router.get("/users", response_model=List[UserAdminOut])
async def list_users(
    admin: Annotated[User, Depends(get_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    query = select(User).where(User.is_guest == False).order_by(desc(User.created_at)).limit(limit).offset(offset)
    if q:
        query = query.where(
            (User.email.ilike(f"%{q}%")) | (User.full_name.ilike(f"%{q}%"))
        )
    result = await db.execute(query)
    users = result.scalars().all()

    out = []
    for u in users:
        chat_count = (
            await db.execute(select(func.count(Chat.id)).where(Chat.user_id == u.id))
        ).scalar() or 0
        out.append(
            UserAdminOut(
                id=u.id,
                email=u.email,
                full_name=u.full_name,
                role=u.role.value,
                is_active=u.is_active,
                is_guest=u.is_guest,
                daily_message_count=u.daily_message_count,
                created_at=u.created_at,
                chat_count=chat_count,
            )
        )
    return out


@router.get("/settings")
async def get_settings(
    admin: Annotated[User, Depends(get_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.services.settings_service import get_daily_message_limit, get_setting, DAILY_LIMIT_KEY

    limit = await get_daily_message_limit()
    return {
        "daily_message_limit": limit,
        "ollama_model": settings.OLLAMA_MODEL,
        "rate_limit_per_minute": settings.RATE_LIMIT_PER_MINUTE,
        "guest_message_limit": settings.GUEST_MESSAGE_LIMIT,
    }


@router.patch("/settings/usage-limit")
async def update_usage_limit(
    data: UsageLimitUpdate,
    admin: Annotated[User, Depends(get_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.services.settings_service import set_setting, DAILY_LIMIT_KEY

    if data.daily_message_limit < 1 or data.daily_message_limit > 100000:
        raise HTTPException(400, "Limit must be between 1 and 100000")
    await set_setting(db, DAILY_LIMIT_KEY, str(data.daily_message_limit))
    return {
        "message": "Daily message limit updated",
        "daily_message_limit": data.daily_message_limit,
    }


@router.post("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: UUID,
    admin: Annotated[User, Depends(get_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = not user.is_active
    await db.commit()
    return {"id": str(user.id), "is_active": user.is_active}
