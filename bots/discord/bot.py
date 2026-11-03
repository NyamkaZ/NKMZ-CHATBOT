"""
Discord Bot integration.
Same pattern as Telegram: routes through the main FastAPI backend.
"""

import os
import asyncio
import httpx
import discord
from discord.ext import commands
import structlog

logger = structlog.get_logger()

API_URL = os.getenv("INTERNAL_API_URL", "http://backend:8000")
DISCORD_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)


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

    text = message.content.replace(f"<@{bot.user.id}>", "").strip()
    if not text:
        return

    user_id = str(message.author.id)
    headers = {"X-Guest-Id": f"dc_{user_id}"}

    async with message.channel.typing():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{API_URL}/api/v1/chats/send",
                    json={"content": text},
                    headers=headers,
                )
                if resp.status_code == 429:
                    await message.reply("⚠️ Daily limit reached.")
                    return
                if resp.status_code >= 400:
                    await message.reply("Sorry, something went wrong.")
                    return
                data = resp.json()
                chat_id = data["chat"]["id"]
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
                await message.reply(content[:2000] if content else "Timed out.")
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
