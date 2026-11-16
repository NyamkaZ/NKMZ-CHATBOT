"""
Discord Bot integration.
Same pattern as Telegram: routes through the main FastAPI backend.
"""

import os
import asyncio
import hashlib
import hmac
from pathlib import Path
from dotenv import load_dotenv
import httpx
import discord
from discord.ext import commands
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
DISCORD_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)
sessions = {}


@bot.event
async def on_ready():
    print(f"Discord bot logged in as {bot.user}")


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if not message.content or message.content.startswith("!"):
        await bot.process_commands(message)
        return

    # Only respond in DMs or when mentioned (optional policy)
    if not isinstance(message.channel, discord.DMChannel) and bot.user not in message.mentions:
        return

    text = message.content.replace(f"<@{bot.user.id}>", "").replace(f"<@!{bot.user.id}>", "").strip()
    if not text:
        return

    user_id = str(message.author.id)
    session = sessions.setdefault(user_id, {})

    async with message.channel.typing():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                if not session.get("access_token"):
                    guest_resp = await client.post(f"{API_URL}/api/v1/auth/guest", headers=INTERNAL_HEADERS)
                    guest_resp.raise_for_status()
                    session["access_token"] = guest_resp.json()["access_token"]
                headers = {"Authorization": f"Bearer {session['access_token']}"}
                resp = await client.post(
                    f"{API_URL}/api/v1/chats/send",
                    json={"content": text, "chat_id": session.get("chat_id")},
                    headers=headers,
                )
                if resp.status_code == 429:
                    await message.reply("⚠️ Daily limit reached.")
                    return
                if resp.status_code in (401, 403):
                    await message.reply("Please register or log in on the website to continue.")
                    return
                if resp.status_code >= 400:
                    await message.reply("Sorry, something went wrong.")
                    return
                data = resp.json()
                chat_id = data["chat"]["id"]
                session["chat_id"] = chat_id
                content = ""
                for _ in range(90):
                    await asyncio.sleep(1.2)
                    chat_resp = await client.get(
                        f"{API_URL}/api/v1/chats/{chat_id}",
                        headers=headers,
                    )
                    if chat_resp.status_code == 200:
                        chat = chat_resp.json()
                        for m in reversed(chat.get("messages", [])):
                            if m["role"] == "assistant" and m["status"] in ("completed", "stopped", "failed"):
                                content = m.get("content") or m.get("error_message") or "..."
                                break
                        if content:
                            break
                content = content or "Timed out."
                for offset in range(0, len(content), 1900):
                    await message.reply(content[offset:offset + 1900])
        except Exception as e:
            logger.exception("discord_error", error=str(e))
            await message.reply("Error occurred.")


def main():
    if not DISCORD_TOKEN:
        print("DISCORD_BOT_TOKEN not set. Skipping Discord bot.")
        return
    bot.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
