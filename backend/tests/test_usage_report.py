from datetime import datetime, timedelta, timezone

from app.models import Chat, Message, User
from app.models.chat import MessageRole, MessageStatus
from app.models.user import UserRole
from app.services import generation
from conftest import make_user, headers


async def make_admin(sessions):
    async with sessions() as session:
        admin = User(email="boss@example.com", role=UserRole.ADMIN, is_guest=False, is_active=True)
        session.add(admin)
        await session.commit()
        return admin


def answer(chat, tokens, prompt, ms, when, **extra):
    return Message(chat_id=chat.id, role=MessageRole.ASSISTANT, content="a", status=MessageStatus.COMPLETED,
                   token_count=tokens, prompt_tokens=prompt, duration_ms=ms, created_at=when, **extra)


async def test_generation_records_prompt_tokens_and_time(env, monkeypatch):
    client, sessions, _ = env
    user = await make_user(sessions)

    async def tokens(**kwargs):
        kwargs["metrics"].update(output_tokens=12, prompt_tokens=340, total_ms=2500)
        yield "Hi"

    monkeypatch.setattr(generation.ollama_service, "stream_chat", tokens)
    sent = await client.post("/api/v1/chats/send", json={"content": "hello"}, headers=headers(user))
    assert sent.status_code == 200, sent.text
    await generation._active_tasks[sent.json()["assistant_message"]["generation_id"]]
    async with sessions() as session:
        saved = await session.get(Message, __import__("uuid").UUID(sent.json()["assistant_message"]["id"]))
        assert (saved.token_count, saved.prompt_tokens, saved.duration_ms) == (12, 340, 2500)


async def test_usage_report_totals_days_and_users(env):
    client, sessions, _ = env
    admin = await make_admin(sessions)
    heavy = await make_user(sessions, email="heavy@example.com")
    light = await make_user(sessions, email="light@example.com")
    now = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    yesterday, long_ago = now - timedelta(days=1), now - timedelta(days=45)
    async with sessions() as session:
        chats = {name: Chat(user_id=owner.id) for name, owner in (("heavy", heavy), ("light", light))}
        chats["guest"] = Chat(guest_id="g-1")
        session.add_all(chats.values())
        await session.flush()
        session.add_all([
            answer(chats["heavy"], 300, 1000, 20000, now),
            answer(chats["heavy"], 200, 900, 10000, yesterday),
            answer(chats["light"], 50, 400, 5000, now),
            answer(chats["guest"], 40, 300, 5000, yesterday),
            # Not counted as model work:
            answer(chats["light"], None, None, None, now, model_name="rag-direct"),        # FAQ, no model
            answer(chats["heavy"], 999, 999, 99999, long_ago),                             # outside the period
            Message(chat_id=chats["heavy"].id, role=MessageRole.USER, content="q", created_at=now),
            Message(chat_id=chats["heavy"].id, role=MessageRole.ASSISTANT, content="", status=MessageStatus.FAILED,
                    token_count=7, created_at=now),
            # Measured before timing existed: counts as tokens, not towards speed.
            answer(chats["light"], 10, None, None, now),
        ])
        await session.commit()

    response = await client.get("/api/v1/admin/usage", params={"days": 7}, headers=headers(admin))
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["answers"] == 5 and report["direct_answers"] == 1
    assert report["output_tokens"] == 600 and report["prompt_tokens"] == 2600
    assert report["model_seconds"] == 40.0 and report["avg_seconds"] == 10.0
    assert report["tokens_per_second"] == 14.8  # 590 timed tokens / 40 s

    assert len(report["daily"]) == 7 and report["daily"][-1]["date"] == now.strftime("%Y-%m-%d")
    assert report["daily"][-1] == {"date": now.strftime("%Y-%m-%d"), "answers": 3, "prompt_tokens": 1400, "output_tokens": 360}
    assert report["daily"][-2]["output_tokens"] == 240
    assert all(day["answers"] == 0 for day in report["daily"][:-2])

    assert [(u["email"], u["output_tokens"], u["answers"]) for u in report["top_users"]] == [
        ("heavy@example.com", 500, 2), ("light@example.com", 60, 2), (None, 40, 1),
    ]


async def test_usage_report_is_admin_only_and_handles_no_data(env):
    client, sessions, _ = env
    admin = await make_admin(sessions)
    user = await make_user(sessions)
    assert (await client.get("/api/v1/admin/usage", headers=headers(user))).status_code == 403
    assert (await client.get("/api/v1/admin/usage")).status_code == 401
    assert (await client.get("/api/v1/admin/usage", params={"days": 0}, headers=headers(admin))).status_code == 422
    empty = (await client.get("/api/v1/admin/usage", headers=headers(admin))).json()
    assert empty["answers"] == 0 and empty["avg_seconds"] is None and empty["tokens_per_second"] is None
    assert len(empty["daily"]) == 30 and empty["top_users"] == []
