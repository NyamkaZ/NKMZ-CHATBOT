from datetime import datetime, timezone, timedelta
from typing import Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import get_redis
from app.models.user import User, UserRole
from app.services.settings_service import get_daily_message_limit
from app.models.user import SubscriptionTier
from app.services.subscription import daily_limit_for_user, effective_tier


def _today_key(user_id: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"usage:{user_id}:{today}"


def _rate_key(user_id: str) -> str:
    return f"rate:{user_id}"


async def _daily_limit(user: User) -> int:
    if effective_tier(user) == SubscriptionTier.FREE:
        return await get_daily_message_limit()
    return daily_limit_for_user(user)


async def check_and_increment_usage(
    db: AsyncSession,
    user: User,
) -> Tuple[bool, int, int, str]:
    """
    Returns (allowed, used, limit, message).
    Enforces daily limit + short-term rate limit via Redis.
    Daily limit is read from DB/Redis settings (admin-changeable).
    """
    if user.role == UserRole.ADMIN:
        return True, 0, 999999, "Admin unlimited"

    redis = await get_redis()
    user_id = str(user.id)
    limit = await _daily_limit(user)

    # Short-term rate limit
    rate_count = await redis.incr(_rate_key(user_id))
    if rate_count == 1:
        await redis.expire(_rate_key(user_id), 60)
    if rate_count > settings.RATE_LIMIT_PER_MINUTE:
        return False, 0, limit, "Rate limit exceeded. Please wait a minute."

    # Daily usage
    used = await redis.incr(_today_key(user_id))
    if used == 1:
        now = datetime.now(timezone.utc)
        tomorrow = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        ttl = int((tomorrow - now).total_seconds()) + 5
        await redis.expire(_today_key(user_id), ttl)

    if used > limit:
        await redis.decr(_today_key(user_id))
        return (
            False,
            used - 1,
            limit,
            f"Daily limit of {limit} messages reached. Upgrade at /pricing or wait until midnight UTC.",
        )

    try:
        today = datetime.now(timezone.utc).date()
        if user.last_message_date is None or user.last_message_date.date() != today:
            user.daily_message_count = 1
            user.last_message_date = datetime.now(timezone.utc)
        else:
            user.daily_message_count = used
        await db.commit()
    except Exception:
        pass

    return True, used, limit, "OK"


async def get_usage(user: User) -> dict:
    tier = effective_tier(user)
    if user.role == UserRole.ADMIN:
        return {
            "daily_limit": 999999,
            "used_today": 0,
            "remaining": 999999,
            "resets_at": None,
            "subscription_tier": tier.value,
        }
    redis = await get_redis()
    used = int(await redis.get(_today_key(str(user.id))) or 0)
    limit = await _daily_limit(user)
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return {
        "daily_limit": limit,
        "used_today": used,
        "remaining": max(0, limit - used),
        "resets_at": tomorrow.isoformat(),
        "subscription_tier": tier.value,
    }
