import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from app.core.security import get_password_hash
from app.models import Chat, Message
from app.models.chat import MessageRole, MessageStatus
from app.services import generation
from conftest import make_user, headers


async def login(client, email, password):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def test_repeated_stop_keeps_partial_answer(env, monkeypatch):
    """A second stop request must not cancel the save of what was already written."""
    _, sessions, _ = env
    user = await make_user(sessions)
    streaming = asyncio.Event()

    async def tokens(**kwargs):
        yield "Partial"
        yield " answer"
        streaming.set()
        await asyncio.Event().wait()
        yield "unreachable"

    saving = asyncio.Event()

    @asynccontextmanager
    async def slow_sessions():
        saving.set()
        await asyncio.sleep(0.05)
        async with sessions() as session:
            yield session

    monkeypatch.setattr(generation.ollama_service, "stream_chat", tokens)
    async with sessions() as session:
        chat = Chat(user_id=user.id)
        session.add(chat)
        await session.flush()
        msg = Message(chat_id=chat.id, role=MessageRole.ASSISTANT, generation_id="double-stop",
                      status=MessageStatus.THINKING)
        session.add(msg)
        await session.commit()
    await generation.set_active_generation(str(chat.id), "double-stop")
    task = generation.start_generation_task("double-stop", str(msg.id), str(chat.id), history=[])
    await asyncio.wait_for(streaming.wait(), 3)
    monkeypatch.setattr(generation, "AsyncSessionLocal", slow_sessions)
    await generation.request_stop("double-stop")
    # The stop monitor (or a second click) sees the same flag while the partial
    # answer is being saved.
    await asyncio.wait_for(saving.wait(), 3)
    await generation.request_stop("double-stop")
    await asyncio.wait_for(task, 3)
    async with sessions() as session:
        saved = await session.get(Message, msg.id)
        assert saved.status == MessageStatus.STOPPED
        assert saved.content == "Partial answer"
    assert not await generation.is_generation_active(str(chat.id))
    assert "double-stop" not in generation._cancel_closed


async def test_email_is_case_insensitive(env):
    client, _, _ = env
    first = await client.post("/api/v1/auth/register", json={"email": "Member@Example.com", "password": "test-password"})
    assert first.status_code == 200, first.text
    duplicate = await client.post("/api/v1/auth/register", json={"email": "member@example.COM", "password": "test-password"})
    assert duplicate.status_code == 400
    assert (await login(client, "MEMBER@example.com", "test-password")).status_code == 200


async def test_login_locks_after_repeated_failures(env):
    client, sessions, _ = env
    await make_user(sessions, email="lock@example.com", hashed_password=get_password_hash("right-password"))
    for _ in range(8):
        assert (await login(client, "lock@example.com", "wrong")).status_code == 401
    # Even the right password is refused while the account is locked.
    assert (await login(client, "lock@example.com", "right-password")).status_code == 429
    # Other accounts are unaffected.
    await make_user(sessions, email="other@example.com", hashed_password=get_password_hash("right-password"))
    assert (await login(client, "other@example.com", "right-password")).status_code == 200


async def test_successful_login_resets_failure_count(env):
    client, sessions, redis = env
    await make_user(sessions, email="reset@example.com", hashed_password=get_password_hash("right-password"))
    for _ in range(3):
        await login(client, "reset@example.com", "wrong")
    assert (await login(client, "reset@example.com", "right-password")).status_code == 200
    assert await redis.get("login_fail:reset@example.com") is None


async def test_profile_update_and_password_change(env):
    client, sessions, _ = env
    user = await make_user(sessions, email="me@example.com", hashed_password=get_password_hash("old-password"))
    renamed = await client.patch("/api/v1/auth/me", json={"full_name": "  Bat   Erdene "}, headers=headers(user))
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["full_name"] == "Bat Erdene"

    wrong = await client.post("/api/v1/auth/change-password",
                              json={"current_password": "nope", "new_password": "new-password"}, headers=headers(user))
    assert wrong.status_code == 400
    same = await client.post("/api/v1/auth/change-password",
                             json={"current_password": "old-password", "new_password": "old-password"}, headers=headers(user))
    assert same.status_code == 400
    short = await client.post("/api/v1/auth/change-password",
                              json={"current_password": "old-password", "new_password": "abc"}, headers=headers(user))
    assert short.status_code == 422
    changed = await client.post("/api/v1/auth/change-password",
                                json={"current_password": "old-password", "new_password": "new-password"}, headers=headers(user))
    assert changed.status_code == 200, changed.text
    # Other devices are signed out; this one continues with the token it was handed.
    assert (await client.get("/api/v1/auth/me", headers=headers(user))).status_code == 401
    fresh = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    assert (await client.get("/api/v1/auth/me", headers=fresh)).status_code == 200
    assert (await login(client, "me@example.com", "old-password")).status_code == 401
    assert (await login(client, "me@example.com", "new-password")).status_code == 200


async def test_guest_cannot_edit_profile_or_password(env):
    client, _, _ = env
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = {"Authorization": f"Bearer {guest['access_token']}"}
    assert (await client.patch("/api/v1/auth/me", json={"full_name": "X"}, headers=auth)).status_code == 403
    response = await client.post("/api/v1/auth/change-password",
                                 json={"current_password": "a", "new_password": "abcdefgh"}, headers=auth)
    assert response.status_code == 403


async def test_pinned_chats_sort_first_and_keep_their_timestamp(env):
    client, sessions, _ = env
    alice, bob = await make_user(sessions), await make_user(sessions)
    older = (await client.post("/api/v1/chats", json={"title": "Older"}, headers=headers(alice))).json()
    await asyncio.sleep(0.02)
    newer = (await client.post("/api/v1/chats", json={"title": "Newer"}, headers=headers(alice))).json()
    listed = (await client.get("/api/v1/chats", headers=headers(alice))).json()
    assert [c["title"] for c in listed] == ["Newer", "Older"]

    pinned = await client.patch(f"/api/v1/chats/{older['id']}", json={"is_pinned": True}, headers=headers(alice))
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["is_pinned"] is True
    assert pinned.json()["title"] == "Older"
    listed = (await client.get("/api/v1/chats", headers=headers(alice))).json()
    assert [(c["title"], c["is_pinned"]) for c in listed] == [("Older", True), ("Newer", False)]
    assert listed[0]["updated_at"] == older["updated_at"]

    stolen = await client.patch(f"/api/v1/chats/{newer['id']}", json={"is_pinned": True}, headers=headers(bob))
    assert stolen.status_code == 404
    blank = await client.patch(f"/api/v1/chats/{newer['id']}", json={"title": "   "}, headers=headers(alice))
    assert blank.status_code == 422


async def test_search_matches_message_text_literally(env):
    client, sessions, _ = env
    alice, bob = await make_user(sessions), await make_user(sessions)
    async with sessions() as session:
        recipes = Chat(user_id=alice.id, title="Dinner ideas")
        discount = Chat(user_id=alice.id, title="Pricing")
        private = Chat(user_id=bob.id, title="Bob's notes")
        session.add_all([recipes, discount, private])
        await session.flush()
        session.add_all([
            Message(chat_id=recipes.id, role=MessageRole.USER, content="How do I cook buuz?"),
            Message(chat_id=discount.id, role=MessageRole.ASSISTANT, content="You get 50% off today"),
            Message(chat_id=private.id, role=MessageRole.USER, content="buuz secret"),
        ])
        await session.commit()

    async def search(q):
        response = await client.get("/api/v1/chats", params={"q": q}, headers=headers(alice))
        assert response.status_code == 200, response.text
        return [c["title"] for c in response.json()]

    assert await search("BUUZ") == ["Dinner ideas"]       # message text, never Bob's
    assert await search("dinner") == ["Dinner ideas"]     # titles still match
    assert await search("50%") == ["Pricing"]
    assert await search("%") == ["Pricing"]               # not a match-everything wildcard
    assert await search("_") == []


async def test_messenger_verification_echoes_challenge(env):
    client, _, _ = env
    ok = await client.get("/api/v1/messenger/webhook", params={
        "hub.mode": "subscribe", "hub.verify_token": "chatbot_verify", "hub.challenge": "abc123"})
    assert ok.status_code == 200 and ok.text == "abc123"
    bad = await client.get("/api/v1/messenger/webhook", params={
        "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "abc123"})
    assert bad.status_code == 403


async def test_guest_gets_three_messages_then_must_sign_in(env, monkeypatch):
    client, _, _ = env

    async def tokens(**kwargs):
        yield "ok"

    monkeypatch.setattr(generation.ollama_service, "stream_chat", tokens)
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = {"Authorization": f"Bearer {guest['access_token']}"}
    chat_id = None
    for number in range(3):
        sent = await client.post("/api/v1/chats/send", json={"content": f"question {number}", "chat_id": chat_id}, headers=auth)
        assert sent.status_code == 200, sent.text
        chat_id = sent.json()["chat"]["id"]
        await generation._active_tasks[sent.json()["assistant_message"]["generation_id"]]
    fourth = await client.post("/api/v1/chats/send", json={"content": "one more", "chat_id": chat_id}, headers=auth)
    assert fourth.status_code == 403
    assert "login" in fourth.json()["detail"].lower()


async def test_guest_sessions_are_limited_per_address(env, monkeypatch):
    from app.api.v1.endpoints.auth import internal_client_token
    from app.core.config import settings

    client, _, _ = env
    monkeypatch.setattr(settings, "GUEST_SESSIONS_PER_IP_PER_HOUR", 2)
    visitor = {"X-Forwarded-For": "8.8.4.4"}
    for _ in range(2):
        assert (await client.post("/api/v1/auth/guest", headers=visitor)).status_code == 200
    blocked = await client.post("/api/v1/auth/guest", headers=visitor)
    assert blocked.status_code == 429
    assert 0 < int(blocked.headers["retry-after"]) <= 3600
    # A forged left-most entry does not buy a fresh allowance...
    forged = await client.post("/api/v1/auth/guest", headers={"X-Forwarded-For": "1.1.1.1, 8.8.4.4"})
    assert forged.status_code == 429
    # ...while a different visitor and the first-party bots are unaffected.
    assert (await client.post("/api/v1/auth/guest", headers={"X-Forwarded-For": "9.9.9.9"})).status_code == 200
    for _ in range(3):
        bot = await client.post("/api/v1/auth/guest", headers={**visitor, "X-Internal-Token": internal_client_token()})
        assert bot.status_code == 200
    wrong = await client.post("/api/v1/auth/guest", headers={**visitor, "X-Internal-Token": "guess"})
    assert wrong.status_code == 429


def test_forwarded_address_is_ignored_from_untrusted_peers():
    from types import SimpleNamespace
    from app.api.v1.endpoints.auth import client_ip

    def request(peer, forwarded=None):
        headers = {"x-forwarded-for": forwarded} if forwarded else {}
        return SimpleNamespace(client=SimpleNamespace(host=peer), headers=headers)

    assert client_ip(request("1.0.0.1", "8.8.4.4")) == "1.0.0.1"   # direct, public peer
    assert client_ip(request("172.18.0.5", "8.8.4.4, 10.0.0.2")) == "8.8.4.4"  # our proxies
    assert client_ip(request("172.18.0.5", "garbage")) == "172.18.0.5"              # nothing usable: fall back to the peer
    assert client_ip(request("172.18.0.5", "::ffff:8.8.4.4")) == "8.8.4.4"          # IPv4-mapped form is folded
    assert client_ip(request("::ffff:172.18.0.5", "::ffff:172.18.0.1")) == "172.18.0.1"
    assert client_ip(request("172.18.0.5")) == "172.18.0.5"


async def test_limit_errors_say_when_to_retry(env, monkeypatch):
    from app.core.config import settings

    client, sessions, redis = env

    async def tokens(**kwargs):
        yield "ok"

    monkeypatch.setattr(generation.ollama_service, "stream_chat", tokens)
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 1)
    fast = await make_user(sessions)
    first = await client.post("/api/v1/chats/send", json={"content": "one"}, headers=headers(fast))
    assert first.status_code == 200, first.text
    await generation._active_tasks[first.json()["assistant_message"]["generation_id"]]
    limited = await client.post("/api/v1/chats/send", json={"content": "two"}, headers=headers(fast))
    assert limited.status_code == 429
    assert 0 < int(limited.headers["retry-after"]) <= 60
    assert not await generation.is_generation_active(first.json()["chat"]["id"])

    spent = await make_user(sessions, daily_message_count=30, last_message_date=datetime.now(timezone.utc))
    daily = await client.post("/api/v1/chats/send", json={"content": "over"}, headers=headers(spent))
    assert daily.status_code == 429
    assert 0 < int(daily.headers["retry-after"]) <= 24 * 3600 + 1


async def test_public_plan_data_has_no_message_counts(env):
    client, sessions, _ = env
    plans = (await client.get("/api/v1/payments/plans")).json()
    assert [plan["id"] for plan in plans["plans"]] == ["free", "pro", "premium"]
    for plan in plans["plans"]:
        assert set(plan) == {"id", "name", "price_usd", "features", "stripe_enabled"}
        assert not any(character.isdigit() for feature in plan["features"] for character in feature)
    user = await make_user(sessions)
    mine = (await client.get("/api/v1/payments/subscription/me", headers=headers(user))).json()
    assert "daily_messages" not in mine and mine["tier"] == "free"
