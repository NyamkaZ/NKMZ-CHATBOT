"""Stripe checkout + webhooks; demo upgrade when Stripe is not configured."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, SubscriptionTier
from app.services.subscription import (
    PLAN_META,
    apply_tier,
    effective_tier,
    get_stripe,
    stripe_configured,
)

logger = structlog.get_logger()
router = APIRouter(prefix="/payments", tags=["payments"])


class CheckoutRequest(BaseModel):
    plan: Literal["pro", "premium"]


class DemoUpgradeRequest(BaseModel):
    plan: Literal["pro", "premium"]


@router.get("/plans")
async def list_plans():
    return {
        "plans": [
            {**v, "id": k, "stripe_enabled": stripe_configured()}
            for k, v in PLAN_META.items()
        ],
        "stripe_enabled": stripe_configured(),
    }


@router.get("/subscription/me")
async def my_subscription(user: Annotated[User, Depends(get_current_user)]):
    tier = effective_tier(user)
    meta = PLAN_META.get(tier.value, PLAN_META["free"])
    return {
        "tier": tier.value,
        "name": meta["name"],
        "daily_messages": meta["daily_messages"],
        "expires_at": user.subscription_expires_at.isoformat()
        if user.subscription_expires_at
        else None,
        "stripe_enabled": stripe_configured(),
    }


@router.post("/checkout")
async def create_checkout(
    body: CheckoutRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if user.is_guest:
        raise HTTPException(401, "Login required to subscribe")
    plan = PLAN_META.get(body.plan)
    if not plan:
        raise HTTPException(400, "Invalid plan")

    if not stripe_configured():
        raise HTTPException(
            503,
            "Stripe is not configured. Use demo upgrade in development or set STRIPE_* env vars.",
        )

    price_id = plan.get("stripe_price_id")
    if not price_id:
        raise HTTPException(
            503,
            f"Missing STRIPE_{body.plan.upper()}_PRICE_ID for plan {body.plan}",
        )

    stripe = get_stripe()
    customer_id = user.stripe_customer_id
    if not customer_id:
        customer = stripe.Customer.create(
            email=user.email,
            metadata={"user_id": str(user.id)},
        )
        customer_id = customer.id
        user.stripe_customer_id = customer_id
        await db.commit()

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{settings.FRONTEND_URL}/pricing?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/pricing?canceled=1",
        metadata={"user_id": str(user.id), "plan": body.plan},
    )
    return {"checkout_url": session.url, "session_id": session.id}


@router.post("/portal")
async def billing_portal(
    user: Annotated[User, Depends(get_current_user)],
):
    if user.is_guest or not user.stripe_customer_id:
        raise HTTPException(400, "No billing account")
    if not stripe_configured():
        raise HTTPException(503, "Stripe not configured")
    stripe = get_stripe()
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}/pricing",
    )
    return {"portal_url": session.url}


@router.post("/demo-upgrade")
async def demo_upgrade(
    body: DemoUpgradeRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Simulate a successful payment when Stripe keys are absent (development only)."""
    if settings.ENVIRONMENT not in ("development", "dev", "local"):
        raise HTTPException(403, "Demo upgrade disabled in production")
    if user.is_guest:
        raise HTTPException(401, "Login required")
    tier = SubscriptionTier.PRO if body.plan == "pro" else SubscriptionTier.PREMIUM
    expires = datetime.now(timezone.utc) + timedelta(days=30)
    await apply_tier(db, user, tier, expires_at=expires)
    return {"tier": tier.value, "expires_at": expires.isoformat(), "demo": True}


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not stripe_configured():
        raise HTTPException(503, "Stripe not configured")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    stripe = get_stripe()
    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.STRIPE_WEBHOOK_SECRET
        )
    except Exception as e:
        logger.warning("stripe_webhook_invalid", error=str(e))
        raise HTTPException(400, "Invalid webhook") from e

    etype = event["type"]
    data = event["data"]["object"]

    if etype == "checkout.session.completed":
        user_id = (data.get("metadata") or {}).get("user_id")
        plan = (data.get("metadata") or {}).get("plan", "pro")
        if user_id:
            from uuid import UUID
            from sqlalchemy import select

            result = await db.execute(select(User).where(User.id == UUID(user_id)))
            user = result.scalar_one_or_none()
            if user:
                tier = (
                    SubscriptionTier.PREMIUM
                    if plan == "premium"
                    else SubscriptionTier.PRO
                )
                sub_id = data.get("subscription")
                cust = data.get("customer")
                await apply_tier(
                    db,
                    user,
                    tier,
                    stripe_customer_id=cust,
                    stripe_subscription_id=sub_id,
                    expires_at=datetime.now(timezone.utc) + timedelta(days=32),
                )

    if etype in ("customer.subscription.deleted", "customer.subscription.updated"):
        sub_id = data.get("id")
        status = data.get("status")
        from sqlalchemy import select

        result = await db.execute(
            select(User).where(User.stripe_subscription_id == sub_id)
        )
        user = result.scalar_one_or_none()
        if user:
            if status in ("active", "trialing"):
                # keep tier
                pass
            else:
                await apply_tier(
                    db,
                    user,
                    SubscriptionTier.FREE,
                    stripe_subscription_id=None,
                    expires_at=None,
                )

    return {"received": True}
