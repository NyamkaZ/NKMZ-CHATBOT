"""
Telegram Bot integration.
Uses the same backend API for consistency (messages, limits, memory).
Run with: python -m bots.telegram.bot
Or as a separate container.
"""

import asyncio
import hashlib
import hmac
import os
from pathlib import Path
from dotenv import load_dotenv
import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import structlog

logger = structlog.get_logger()
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

API_URL = os.getenv("INTERNAL_API_URL", "http://localhost:8000").rstrip("/")
# Proves to the backend that guest sessions come from this first-party bot, so
# all chat users are not counted as one visitor (must match auth.internal_client_token).
INTERNAL_HEADERS = {"X-Internal-Token": hmac.new(
    os.getenv("SECRET_KEY", "change-me-in-production-use-openssl-rand-hex-32").encode(),
    b"nkmz-internal-client", hashlib.sha256,
).hexdigest()}
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Hello! I'm your AI assistant.\n"
        "Just send me a message and I'll reply.\n"
        "Note: usage limits apply the same as the website."
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
    user_id = str(update.effective_user.id)
    text = update.message.text

    # For simplicity we create a guest-like session keyed by telegram user id.
    # In production you would map telegram_id → platform user.
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            if not context.user_data.get("access_token"):
                guest_resp = await client.post(f"{API_URL}/api/v1/auth/guest", headers=INTERNAL_HEADERS)
                guest_resp.raise_for_status()
                context.user_data["access_token"] = guest_resp.json()["access_token"]
            headers = {"Authorization": f"Bearer {context.user_data['access_token']}"}
            # Send message via backend
            resp = await client.post(
                f"{API_URL}/api/v1/chats/send",
                json={"content": text, "chat_id": context.user_data.get("chat_id")},
                headers=headers,
            )
            if resp.status_code == 429:
                await update.message.reply_text("⚠️ Daily message limit reached. Please try again tomorrow.")
                return
            if resp.status_code in (401, 403):
                await update.message.reply_text("🔐 Please register on the website to continue.")
                return
            if resp.status_code >= 400:
                await update.message.reply_text("Sorry, something went wrong. Please try again.")
                logger.error("tg_backend_error", status=resp.status_code, body=resp.text)
                return

            data = resp.json()
            context.user_data["chat_id"] = data["chat"]["id"]
            # Poll / stream for completion (simplified polling)
            content = ""
            for _ in range(120):
                await asyncio.sleep(1)
                # Better: after a short wait fetch the chat again
                chat_id = data["chat"]["id"]
                chat_resp = await client.get(
                    f"{API_URL}/api/v1/chats/{chat_id}",
                    headers=headers,
                )
                if chat_resp.status_code == 200:
                    chat = chat_resp.json()
                    for m in reversed(chat.get("messages", [])):
                        if m["role"] == "assistant" and m["status"] in ("completed", "stopped", "failed"):
                            content = m["content"] or m.get("error_message") or "..."
                            break
                    if content:
                        break
            content = content or "Generation timed out."
            for offset in range(0, len(content), 4000):
                await update.message.reply_text(content[offset:offset + 4000])
    except Exception as e:
        logger.exception("tg_handle_error", error=str(e))
        await update.message.reply_text("Sorry, I encountered an error.")


def main():
    if not TELEGRAM_TOKEN:
        print("TELEGRAM_BOT_TOKEN not set. Skipping Telegram bot.")
        return
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    print("Telegram bot starting...")
    app.run_polling()


if __name__ == "__main__":
    main()
