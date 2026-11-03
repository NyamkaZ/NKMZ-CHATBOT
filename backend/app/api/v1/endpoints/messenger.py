"""
Facebook Messenger webhook skeleton.
Configure the webhook URL to: https://your-domain/api/v1/messenger/webhook
"""
from typing import Annotated, Optional
from fastapi import APIRouter, Request, Query, HTTPException, Depends
from app.core.config import settings
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/messenger", tags=["messenger"])


@router.get("/webhook")
async def verify_webhook(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == settings.FACEBOOK_VERIFY_TOKEN:
        return int(hub_challenge or 0)
    raise HTTPException(403, "Verification failed")


@router.post("/webhook")
async def webhook(request: Request):
    body = await request.json()
    logger.info("messenger_webhook", body=body)
    # TODO: parse messaging events, call the same chat send service,
    # then POST the reply back to Facebook Graph API using PAGE_ACCESS_TOKEN.
    return {"status": "ok"}
