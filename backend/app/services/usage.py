from datetime import datetime, timezone, timedelta
from typing import Tuple

from fastapi import HTTPException
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
    allowed, used, limit, message, _ = await _reserve_usage(db, user)
    return allowed, used, limit, message


async def enforce_usage(db: AsyncSession, user: User) -> None:
    """Reserve one message or raise 429 with Retry-After (seconds until allowed)."""
    allowed, _, _, message, retry_after = await _reserve_usage(db, user)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=message,
            headers={"Retry-After": str(max(1, retry_after))},
        )


async def _reserve_usage(db: AsyncSession, user: User) -> Tuple[bool, int, int, str, int]:
    if user.role == UserRole.ADMIN:
        return True, 0, 999999, "Admin unlimited", 0

    redis = await get_redis()
    user_id = str(user.id)
    limit = await _daily_limit(user)

    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    baseline = user.daily_message_count if user.last_message_date and user.last_message_date.date() == now.date() else 0
    # Counter initialization, expiry, and reservation must be one operation.
    # Restore today's DB mirror when Redis has restarted.
    code, used = await redis.eval(
        "local used = tonumber(redis.call('get', KEYS[1]) or ARGV[4]); "
        "local rate = tonumber(redis.call('get', KEYS[2]) or '0'); "
        "if rate >= tonumber(ARGV[2]) then return {0, used} end; "
        "if used >= tonumber(ARGV[1]) then return {-1, used} end; "
        "redis.call('set', KEYS[1], used + 1, 'EX', ARGV[3]); "
        "redis.call('incr', KEYS[2]); "
        "if rate == 0 then redis.call('expire', KEYS[2], 60) end; "
        "return {1, used + 1}",
        2, _today_key(user_id), _rate_key(user_id), limit,
        settings.RATE_LIMIT_PER_MINUTE, int((tomorrow - now).total_seconds()) + 5, baseline,
    )
    if code == 0:
        ttl = await redis.ttl(_rate_key(user_id))
        return False, used, limit, "Rate limit exceeded. Please wait a minute.", ttl if ttl and ttl > 0 else 60
    if code == -1:
        return (
            False,
            used,
            limit,
            f"Daily limit of {limit} messages reached. Upgrade at /pricing or wait until midnight UTC.",
            int((tomorrow - now).total_seconds()) + 1,
        )

    try:
        today = datetime.now(timezone.utc).date()
        user.daily_message_count = used
        user.last_message_date = now
        await db.flush()
    except Exception:
        await redis.decr(_today_key(user_id))
        raise

    return True, used, limit, "OK", 0


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
    cached = await redis.get(_today_key(str(user.id)))
    baseline = user.daily_message_count if user.last_message_date and user.last_message_date.date() == datetime.now(timezone.utc).date() else 0
    used = int(cached) if cached is not None else baseline
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
