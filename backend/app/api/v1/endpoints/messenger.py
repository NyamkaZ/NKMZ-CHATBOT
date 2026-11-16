"""
Facebook Messenger webhook skeleton.
Configure the webhook URL to: https://your-domain/api/v1/messenger/webhook
"""
import hmac
from typing import Annotated, Optional
from fastapi import APIRouter, Request, Query, HTTPException, Depends
from fastapi.responses import PlainTextResponse
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
    expected = settings.FACEBOOK_VERIFY_TOKEN
    if hub_mode == "subscribe" and expected and hmac.compare_digest(
        (hub_verify_token or "").encode(), expected.encode()
    ):
        # Facebook expects the challenge echoed back verbatim.
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(403, "Verification failed")


@router.post("/webhook")
async def webhook(request: Request):
    body = await request.json()
    # Message bodies are personal data: log the shape, not the content.
    logger.info("messenger_webhook", entries=len(body.get("entry") or []) if isinstance(body, dict) else 0)
    # TODO: parse messaging events, call the same chat send service,
    # then POST the reply back to Facebook Graph API using PAGE_ACCESS_TOKEN.
    return {"status": "ok"}
