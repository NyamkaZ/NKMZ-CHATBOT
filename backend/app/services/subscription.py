"""Subscription tiers, limits, and Stripe helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User, SubscriptionTier

logger = structlog.get_logger()

PLAN_LIMITS: Dict[SubscriptionTier, int] = {
    SubscriptionTier.FREE: settings.DAILY_MESSAGE_LIMIT,
    SubscriptionTier.PRO: settings.PRO_DAILY_MESSAGE_LIMIT,
    SubscriptionTier.PREMIUM: settings.PREMIUM_DAILY_MESSAGE_LIMIT,
}

PLAN_META: Dict[str, Dict[str, Any]] = {
    "free": {
        "tier": SubscriptionTier.FREE,
        "name": "Free",
        "price_usd": 0,
        "daily_messages": settings.DAILY_MESSAGE_LIMIT,
        "features": [
            "30 messages / day",
            "RAG knowledge base",
            "Guest try-before-login",
        ],
    },
    "pro": {
        "tier": SubscriptionTier.PRO,
        "name": "Pro",
        "price_usd": settings.STRIPE_PRO_PRICE_USD,
        "daily_messages": settings.PRO_DAILY_MESSAGE_LIMIT,
        "stripe_price_id": settings.STRIPE_PRO_PRICE_ID,
        "features": [
            "200 messages / day",
            "Priority generation",
            "All AI personas",
            "Export chats",
        ],
    },
    "premium": {
        "tier": SubscriptionTier.PREMIUM,
        "name": "Premium",
        "price_usd": settings.STRIPE_PREMIUM_PRICE_USD,
        "daily_messages": settings.PREMIUM_DAILY_MESSAGE_LIMIT,
        "stripe_price_id": settings.STRIPE_PREMIUM_PRICE_ID,
        "features": [
            "1000 messages / day",
            "Deep thinking mode",
            "Knowledge base uploads",
            "Early features",
        ],
    },
}


def effective_tier(user: User) -> SubscriptionTier:
    tier = getattr(user, "subscription_tier", None) or SubscriptionTier.FREE
    if tier == SubscriptionTier.FREE:
        return SubscriptionTier.FREE
    exp = getattr(user, "subscription_expires_at", None)
    if exp:
        exp_utc = exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
        if exp_utc < datetime.now(timezone.utc):
            return SubscriptionTier.FREE
    return tier


def daily_limit_for_user(user: User) -> int:
    return PLAN_LIMITS.get(effective_tier(user), settings.DAILY_MESSAGE_LIMIT)


async def apply_tier(
    db: AsyncSession,
    user: User,
    tier: SubscriptionTier,
    *,
    stripe_customer_id: Optional[str] = None,
    stripe_subscription_id: Optional[str] = None,
    expires_at: Optional[datetime] = None,
) -> None:
    user.subscription_tier = tier
    if stripe_customer_id:
        user.stripe_customer_id = stripe_customer_id
    if stripe_subscription_id is not None:
        user.stripe_subscription_id = stripe_subscription_id
    user.subscription_expires_at = expires_at
    await db.commit()
    await db.refresh(user)
    logger.info("subscription_updated", user_id=str(user.id), tier=tier.value)


def stripe_configured() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_WEBHOOK_SECRET)


def get_stripe():
    import stripe

    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe
