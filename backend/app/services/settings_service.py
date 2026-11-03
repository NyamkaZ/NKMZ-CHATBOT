"""Read/write system settings. Redis cache for hot path (daily limit)."""

from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.core.redis import get_redis
from app.core.database import AsyncSessionLocal
from app.models.settings import SystemSetting

DAILY_LIMIT_KEY = "daily_message_limit"
REDIS_CACHE_KEY = "sys:daily_message_limit"


async def get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else default


async def set_setting(db: AsyncSession, key: str, value: str) -> None:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(
            SystemSetting(
                key=key,
                value=value,
                updated_at=datetime.now(timezone.utc),
            )
        )
    await db.commit()
    if key == DAILY_LIMIT_KEY:
        redis = await get_redis()
        await redis.set(REDIS_CACHE_KEY, value, ex=3600)


async def get_daily_message_limit() -> int:
    """Fast path: Redis → DB → env default."""
    try:
        redis = await get_redis()
        cached = await redis.get(REDIS_CACHE_KEY)
        if cached is not None:
            return int(cached)
    except Exception:
        pass

    try:
        async with AsyncSessionLocal() as db:
            val = await get_setting(db, DAILY_LIMIT_KEY, str(env_settings.DAILY_MESSAGE_LIMIT))
            limit = int(val)
            try:
                redis = await get_redis()
                await redis.set(REDIS_CACHE_KEY, str(limit), ex=3600)
            except Exception:
                pass
            return limit
    except Exception:
        return env_settings.DAILY_MESSAGE_LIMIT
