from datetime import datetime, timezone, timedelta
from typing import Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import get_redis
from app.models.user import User, UserRole, SubscriptionTier
from app.services.settings_service import get_daily_message_limit
from app.services.subscription import daily_limit_for_user, effective_tier

GUEST_MESSAGE_LIMIT = 1
_DAY_TTL_SLACK = 5

# Atomic check-and-increment in one round-trip.
# Returns the new counter on success, -1 when the limit is already exhausted.
_INCR_IF_BELOW = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then
  return -1
end
current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return current
"""


def _today_key(user_id: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"usage:{user_id}:{today}"


def _rate_key(user_id: str) -> str:
    return f"rate:{user_id}"


def _usage_subject(user: User) -> str:
    """Redis key subject.

    Guests have no real account id, so key them by guest_id — otherwise every
    guest would share a single counter.
    """
    if user.is_guest and user.guest_id:
        return f"guest:{user.guest_id}"
    return str(user.id)


async def _daily_limit(user: User) -> int:
    if user.is_guest:
        return GUEST_MESSAGE_LIMIT
    if effective_tier(user) == SubscriptionTier.FREE:
        return await get_daily_message_limit()
    return daily_limit_for_user(user)


def _seconds_until_midnight_utc() -> int:
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int((tomorrow - now).total_seconds()) + _DAY_TTL_SLACK


async def check_and_increment_usage(
    db: AsyncSession,
    user: User,
) -> Tuple[bool, int, int, str]:
    """
    Returns (allowed, used, limit, message).

    Enforces the daily limit plus a short-term rate limit, both in Redis.
    Display limits are admin-changeable and are read on every call.
    """
    if user.role == UserRole.ADMIN:
        return True, 0, 999999, "Admin unlimited"

    redis = await get_redis()
    subject = _usage_subject(user)
    limit = await _daily_limit(user)

    # Short-term rate limit — applies to guests too.
    rate_count = await redis.incr(_rate_key(subject))
    if rate_count == 1:
        await redis.expire(_rate_key(subject), 60)
    if rate_count > settings.RATE_LIMIT_PER_MINUTE:
        return False, 0, limit, "Хэт олон хүсэлт илгээгдлээ. Нэг минут хүлээнэ үү."

    # Atomic daily check + increment (no read-then-write race between requests).
    used = int(
        await redis.eval(
            _INCR_IF_BELOW,
            1,
            _today_key(subject),
            str(limit),
            str(_seconds_until_midnight_utc()),
        )
    )
    if used < 0:
        current = int(await redis.get(_today_key(subject)) or limit)
        if user.is_guest:
            return (
                False,
                current,
                limit,
                "Зочин хэрэглэгч зөвхөн 1 мессеж илгээх боломжтой. "
                "Үргэлжлүүлэхийн тулд нэвтэрнэ үү.",
            )
        return (
            False,
            current,
            limit,
            f"Өдрийн {limit} мессежийн хязгаар дууссан. "
            "/pricing хуудаснаас багцаа ахиулж болно.",
        )

    # DB mirror — best effort only; Redis stays the source of truth.
    try:
        user.daily_message_count = used
        if user.last_message_date is None or user.last_message_date.date() != datetime.now(
            timezone.utc
        ).date():
            user.last_message_date = datetime.now(timezone.utc)
        await db.commit()
    except Exception:
        await db.rollback()

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
            "is_guest": False,
        }

    redis = await get_redis()
    subject = _usage_subject(user)
    used = int(await redis.get(_today_key(subject)) or 0)
    limit = await _daily_limit(user)

    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return {
        "daily_limit": limit,
        "used_today": used,
        "remaining": max(0, limit - used),
        "resets_at": tomorrow.isoformat(),
        "subscription_tier": tier.value,
        "is_guest": bool(user.is_guest),
    }
