"""
Telegram Bot integration.
Uses the same backend API for consistency (messages, limits, memory).
Run with: python -m bots.telegram.bot
Or as a separate container.
"""

import asyncio
import os
import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import structlog

logger = structlog.get_logger()

API_URL = os.getenv("INTERNAL_API_URL", "http://backend:8000")
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
            # Ensure guest / map exists (simplified: use telegram id as guest)
            headers = {"X-Guest-Id": f"tg_{user_id}"}
            # Send message via backend
            resp = await client.post(
                f"{API_URL}/api/v1/chats/send",
                json={"content": text},
                headers=headers,
            )
            if resp.status_code == 429:
                await update.message.reply_text("⚠️ Daily message limit reached. Please try again tomorrow.")
                return
            if resp.status_code == 403:
                await update.message.reply_text("🔐 Please register on the website to continue.")
                return
            if resp.status_code >= 400:
                await update.message.reply_text("Sorry, something went wrong. Please try again.")
                logger.error("tg_backend_error", status=resp.status_code, body=resp.text)
                return

            data = resp.json()
            gen_id = data["assistant_message"]["generation_id"]
            # Poll / stream for completion (simplified polling)
            content = ""
            for _ in range(120):
                state_resp = await client.get(f"{API_URL}/api/v1/stream/{gen_id}")
                # In real bot we would properly consume SSE; here we use a short sleep + final DB fetch
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
            await update.message.reply_text(content or "Generation timed out.")
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
