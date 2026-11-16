import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_access_token
from app.models import Chat, Message, User
from app.models.chat import MessageRole, MessageStatus
from app.models.user import SubscriptionTier
from app.services import generation
from app.services.llm.ollama import OllamaService
from app.services.subscription import apply_tier, effective_tier
from conftest import make_user, headers


async def conversation(client, user):
    response = await client.post("/api/v1/chats", json={}, headers=headers(user))
    assert response.status_code == 200, response.text
    assert response.json()["messages"] == []
    return response.json()["id"]


async def test_chat_isolation_and_serialization(env):
    client, sessions, _ = env
    alice = await make_user(sessions)
    bob = await make_user(sessions)
    chat_id = await conversation(client, alice)
    assert (await client.get("/api/v1/chats", headers=headers(bob))).json() == []
    assert len((await client.get("/api/v1/chats", headers=headers(alice))).json()) == 1
    assert (await client.get(f"/api/v1/chats/{chat_id}", headers=headers(bob))).status_code == 403
    for method in ("patch", "delete"):
        kwargs = {"json": {"title": "stolen"}} if method == "patch" else {}
        response = await getattr(client, method)(f"/api/v1/chats/{chat_id}", headers=headers(bob), **kwargs)
        assert response.status_code == 404
    renamed = await client.patch(f"/api/v1/chats/{chat_id}", json={"title": "Mine"}, headers=headers(alice))
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "Mine"


async def test_rejected_send_does_not_consume_usage(env):
    client, sessions, redis = env
    alice, bob = await make_user(sessions), await make_user(sessions)
    chat_id = await conversation(client, alice)
    response = await client.post("/api/v1/chats/send", json={"chat_id": chat_id, "content": "hello"}, headers=headers(bob))
    assert response.status_code == 403
    assert await redis.keys(f"usage:{bob.id}:*") == []


async def test_stop_and_stream_require_owner(env):
    client, sessions, redis = env
    alice, bob = await make_user(sessions), await make_user(sessions)
    chat_id = await conversation(client, alice)
    gen_id = str(uuid.uuid4())
    async with sessions() as session:
        message = Message(chat_id=uuid.UUID(chat_id), role=MessageRole.ASSISTANT,
                          generation_id=gen_id, content="private", status=MessageStatus.COMPLETED)
        session.add(message)
        await session.commit()
        message_id = message.id
    endpoint = f"/api/v1/stream/{gen_id}"
    assert (await client.get(endpoint)).status_code == 401
    assert (await client.get(endpoint, params={"token": create_access_token(bob.id)})).status_code == 404
    response = await client.get(endpoint, params={"token": create_access_token(alice.id)})
    assert response.status_code == 200
    assert '"content": "private"' in response.text
    response = await client.post(f"/api/v1/chats/{chat_id}/messages/{message_id}/stop", headers=headers(bob))
    assert response.status_code == 404
    assert await redis.get(f"gen:{gen_id}:stop") is None


async def test_expired_guest_is_not_reauthenticated_by_header(env):
    client, sessions, _ = env
    data = (await client.post("/api/v1/auth/guest")).json()
    async with sessions() as session:
        guest = (await session.execute(select(User).where(User.guest_id == data["guest_id"]))).scalar_one()
        guest.is_active = False
        await session.commit()
    response = await client.get("/api/v1/auth/me", headers={"X-Guest-Id": data["guest_id"]})
    assert response.status_code == 401


async def test_malformed_subject_and_invalid_token_cannot_fall_back(env):
    client, _, _ = env
    data = (await client.post("/api/v1/auth/guest")).json()
    for token in (create_access_token("not-a-uuid"), "invalid"):
        response = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}", "X-Guest-Id": data["guest_id"]})
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


async def test_guest_limit_counts_enum_messages(env, monkeypatch):
    client, sessions, _ = env
    monkeypatch.setattr(settings, "GUEST_MESSAGE_LIMIT", 1)
    data = (await client.post("/api/v1/auth/guest")).json()
    auth = {"Authorization": f"Bearer {data['access_token']}"}
    chat_id = (await client.post("/api/v1/chats", json={}, headers=auth)).json()["id"]
    async with sessions() as session:
        session.add(Message(chat_id=uuid.UUID(chat_id), role=MessageRole.USER, content="first"))
        await session.commit()
    response = await client.post("/api/v1/chats/send", json={"content": "second"}, headers=auth)
    assert response.status_code == 403


async def test_active_generation_is_not_interrupted_or_charged(env):
    client, sessions, redis = env
    user = await make_user(sessions)
    chat_id = await conversation(client, user)
    assert await generation.set_active_generation(chat_id, "running")
    response = await client.post("/api/v1/chats/send", json={"chat_id": chat_id, "content": "second"}, headers=headers(user))
    assert response.status_code == 409
    assert await redis.get(f"chat:{chat_id}:active_gen") == "running"
    assert await redis.keys(f"usage:{user.id}:*") == []


async def test_generation_lock_is_atomic_and_only_owner_can_release(env):
    _, _, redis = env
    results = await asyncio.gather(*(generation.set_active_generation("chat", str(n)) for n in range(10)))
    assert results.count(True) == 1
    owner = await redis.get("chat:chat:active_gen")
    await generation.clear_active_generation("chat", "wrong")
    assert await redis.get("chat:chat:active_gen") == owner
    await generation.clear_active_generation("chat", owner)
    assert not await generation.is_generation_active("chat")


async def test_send_and_background_persistence(env, monkeypatch):
    client, sessions, _ = env
    user = await make_user(sessions)
    async def tokens(**kwargs):
        yield "Hello"
        yield " world"
    monkeypatch.setattr(generation.ollama_service, "stream_chat", tokens)
    monkeypatch.setattr(generation.ollama_service, "generate_title", AsyncMock(return_value="Greeting"))
    response = await client.post("/api/v1/chats/send", json={"content": "hi"}, headers=headers(user))
    assert response.status_code == 200, response.text
    data = response.json()
    gen_id = data["assistant_message"]["generation_id"]
    await generation._active_tasks[gen_id]
    chat = (await client.get(f"/api/v1/chats/{data['chat']['id']}", headers=headers(user))).json()
    assert chat["title"] == "hi"
    generation.ollama_service.generate_title.assert_not_awaited()
    assert [m["content"] for m in chat["messages"]] == ["hi", "Hello world"]
    assert chat["messages"][-1]["status"] == "completed"
    assert not await generation.is_generation_active(data["chat"]["id"])
    replay = await client.get(f"/api/v1/stream/{gen_id}", params={"token": create_access_token(user.id)})
    assert "Hello world" in replay.text and "event: done" in replay.text


async def test_generation_initialization_failure_releases_lock(env, monkeypatch):
    _, sessions, redis = env
    user = await make_user(sessions)
    async with sessions() as session:
        chat = Chat(user_id=user.id)
        session.add(chat)
        await session.flush()
        msg = Message(chat_id=chat.id, role=MessageRole.ASSISTANT, generation_id="broken", status=MessageStatus.THINKING)
        session.add(msg)
        await session.commit()
    await generation.set_active_generation(str(chat.id), "broken")
    monkeypatch.setattr(generation, "_run_generation", AsyncMock(side_effect=RuntimeError("Redis restarted")))
    await generation.run_generation("broken", str(msg.id), str(chat.id), history=[])
    assert not await generation.is_generation_active(str(chat.id))
    async with sessions() as session:
        assert (await session.get(Message, msg.id)).status == MessageStatus.FAILED


async def test_dedicated_worker_setting_enqueues(env, monkeypatch):
    _, _, redis = env
    monkeypatch.setattr(settings, "USE_GENERATION_WORKER", True)
    await generation.start_generation_task("queued", str(uuid.uuid4()), "chat", [])
    assert json.loads(await redis.lpop("gen:queue"))["generation_id"] == "queued"


async def test_subscription_values_and_cancellation(env):
    _, sessions, _ = env
    assert User.__table__.c.subscription_tier.type.enums == ["free", "pro", "premium"]
    user = await make_user(sessions, subscription_tier=SubscriptionTier.PRO, stripe_subscription_id="sub_1")
    async with sessions() as session:
        user = await session.get(User, user.id)
        await apply_tier(session, user, SubscriptionTier.FREE, stripe_subscription_id=None)
        assert user.stripe_subscription_id is None
    user.subscription_tier = SubscriptionTier.PRO
    user.subscription_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    assert effective_tier(user) == SubscriptionTier.FREE


async def test_validation_errors_and_cors(env):
    client, _, _ = env
    response = await client.post("/api/v1/auth/register", json={"email": "invalid", "password": "x"}, headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 422
    assert "access-control-allow-origin" not in response.headers
    response = await client.options("/api/v1/auth/register", headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"})
    assert response.status_code == 400
    response = await client.get("/api/v1/auth/me", headers={"Origin": "http://localhost:3000"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


@pytest.mark.parametrize("mode,enabled", [("think", True), ("on", True), ("off", False), ("no_think", False)])
async def test_documented_thinking_modes(monkeypatch, mode, enabled):
    import httpx
    from app.services.llm import ollama
    monkeypatch.setattr(settings, "QWEN_THINKING_MODE", mode)
    payloads = []
    def respond(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, text=json.dumps({"message": {"content": "Hi"}, "done": True}) + "\n")
    actual_client = httpx.AsyncClient
    monkeypatch.setattr(ollama.httpx, "AsyncClient", lambda **kwargs: actual_client(transport=httpx.MockTransport(respond), **kwargs))
    service = OllamaService()
    monkeypatch.setattr(service, "resolve_base_url", AsyncMock(return_value="http://ollama"))
    monkeypatch.setattr(service, "ensure_model_name", AsyncMock(return_value="qwen3:8b"))
    assert [t async for t in service.stream_chat([{"role": "user", "content": "Hi"}])] == ["Hi"]
    assert payloads[0]["think"] is enabled
    assert payloads[0]["messages"][-1]["content"] == "Hi"
    await service.aclose()


async def test_document_delete_removes_index(env, monkeypatch, tmp_path):
    from app.api.v1.endpoints import documents
    from app.models import Document
    from app.models.user import UserRole
    client, sessions, _ = env
    user = await make_user(sessions)
    async with sessions() as session:
        admin = await session.get(User, user.id)
        admin.role = UserRole.ADMIN
        doc = Document(filename="document.txt", original_name="document.txt")
        session.add(doc)
        await session.commit()
    monkeypatch.setattr(documents, "UPLOAD_DIR", tmp_path)
    (tmp_path / "document.txt").write_text("test")
    remove = AsyncMock()
    monkeypatch.setattr(documents, "delete_indexed_document", remove)
    response = await client.delete(f"/api/v1/documents/{doc.id}", headers=headers(user))
    assert response.status_code == 204, response.text
    remove.assert_awaited_once_with(str(doc.id))
    assert not (tmp_path / "document.txt").exists()


async def test_register_links_guest_chats_and_invalidates_old_session(env):
    client, _, _ = env
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = {"X-Guest-Id": guest["guest_id"]}
    chat_id = (await client.post("/api/v1/chats", json={}, headers=auth)).json()["id"]
    response = await client.post("/api/v1/auth/register", json={"email": "member@example.com", "password": "test-password"}, headers=auth)
    assert response.status_code == 200, response.text
    user_auth = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert (await client.get("/api/v1/chats", headers=user_auth)).json()[0]["id"] == chat_id
    assert (await client.get("/api/v1/auth/me", headers=auth)).status_code == 401
    assert (await client.get(f"/api/v1/stream/missing", params={"guest_id": guest["guest_id"]})).status_code == 401


async def test_custom_validation_errors_are_json_serializable(env):
    client, _, _ = env
    response = await client.post("/api/v1/auth/register", json={"email": "member@example.com", "password": "а" * 40})
    assert response.status_code == 422
    assert "72 UTF-8 bytes" in response.text


def test_faq_requires_confident_question_match():
    from app.services.rag.pipeline import extract_faq_answer
    faq = [{"content": "Question: What are your hours?\nAnswer: Weekdays 9–5.\n\nQuestion: Where is your office?\nAnswer: Main street."}]
    assert extract_faq_answer(faq, "What are your hours?") == "Weekdays 9–5."
    assert extract_faq_answer(faq, "Where is your office?") == "Main street."
    assert extract_faq_answer(faq, "Can you explain office software?") is None
    assert extract_faq_answer([{"content": "Unstructured unrelated office notes"}], "office hours?") is None


async def test_stripe_renewal_uses_current_paid_period(env, monkeypatch):
    from app.api.v1.endpoints import payments
    client, sessions, _ = env
    user = await make_user(sessions, subscription_tier=SubscriptionTier.PRO,
                           stripe_customer_id="cus_1", stripe_subscription_id="sub_1")
    expires = datetime.now(timezone.utc) + timedelta(days=60)
    stripe = MagicMock()
    stripe.Webhook.construct_event.return_value = {
        "type": "customer.subscription.updated", "data": {"object": {"id": "sub_1"}}
    }
    stripe.Subscription.retrieve.return_value = {
        "id": "sub_1", "customer": "cus_1", "status": "active",
        "current_period_end": int(expires.timestamp()),
        "items": {"data": [{"price": {"id": "price_pro"}}]},
    }
    monkeypatch.setattr(payments, "get_stripe", lambda: stripe)
    monkeypatch.setattr(payments, "stripe_configured", lambda: True)
    monkeypatch.setattr(settings, "STRIPE_PRO_PRICE_ID", "price_pro")
    response = await client.post("/api/v1/payments/webhook", content="{}")
    assert response.status_code == 200, response.text
    async with sessions() as session:
        saved = await session.get(User, user.id)
        assert saved.subscription_tier == SubscriptionTier.PRO
        assert int(saved.subscription_expires_at.replace(tzinfo=timezone.utc).timestamp()) == int(expires.timestamp())
    stripe.Subscription.retrieve.return_value["status"] = "canceled"
    response = await client.post("/api/v1/payments/webhook", content="{}")
    assert response.status_code == 200
    async with sessions() as session:
        saved = await session.get(User, user.id)
        assert saved.subscription_tier == SubscriptionTier.FREE
        assert saved.stripe_subscription_id is None


async def test_usage_survives_redis_counter_loss(env):
    client, sessions, _ = env
    user = await make_user(sessions, daily_message_count=30, last_message_date=datetime.now(timezone.utc))
    usage = (await client.get("/api/v1/chats/usage/me", headers=headers(user))).json()
    assert usage["used_today"] == 30
    response = await client.post("/api/v1/chats/send", json={"content": "over quota"}, headers=headers(user))
    assert response.status_code == 429


async def test_stop_interrupts_worker_before_first_token(env, monkeypatch):
    _, sessions, redis = env
    user = await make_user(sessions)
    started = asyncio.Event()
    async def tokens(**kwargs):
        started.set()
        await asyncio.Event().wait()
        yield "unreachable"
    monkeypatch.setattr(generation.ollama_service, "stream_chat", tokens)
    async with sessions() as session:
        chat = Chat(user_id=user.id)
        session.add(chat)
        await session.flush()
        msg = Message(chat_id=chat.id, role=MessageRole.ASSISTANT, generation_id="stop-test", status=MessageStatus.THINKING)
        session.add(msg)
        await session.commit()
    await generation.set_active_generation(str(chat.id), "stop-test")
    task = asyncio.create_task(generation.run_generation("stop-test", str(msg.id), str(chat.id), history=[]))
    await asyncio.wait_for(started.wait(), 3)
    await redis.set("gen:stop-test:stop", "1")
    await asyncio.wait_for(task, 3)
    async with sessions() as session:
        assert (await session.get(Message, msg.id)).status == MessageStatus.STOPPED
    assert not await generation.is_generation_active(str(chat.id))


async def test_ollama_preserves_terminal_token_and_disables_thinking(monkeypatch):
    import httpx
    from app.services.llm import ollama
    payloads = []
    def respond(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, text=json.dumps({"message": {"content": "last token"}, "done": True}) + "\n")
    client_class = httpx.AsyncClient
    monkeypatch.setattr(ollama.httpx, "AsyncClient", lambda **kwargs: client_class(transport=httpx.MockTransport(respond), **kwargs))
    monkeypatch.setattr(settings, "QWEN_THINKING_MODE", "no_think")
    service = OllamaService()
    monkeypatch.setattr(service, "resolve_base_url", AsyncMock(return_value="http://ollama"))
    monkeypatch.setattr(service, "ensure_model_name", AsyncMock(return_value="qwen3:8b"))
    assert [token async for token in service.stream_chat([{"role": "user", "content": "Hi"}])] == ["last token"]
    assert payloads[0]["think"] is False
    await service.aclose()


async def test_restart_recovery_preserves_partial_output_and_unlocks_chat(env):
    _, sessions, redis = env
    user = await make_user(sessions)
    async with sessions() as session:
        chat = Chat(user_id=user.id)
        session.add(chat)
        await session.flush()
        msg = Message(chat_id=chat.id, role=MessageRole.ASSISTANT, generation_id="orphan", status=MessageStatus.STREAMING)
        session.add(msg)
        await session.commit()
    await generation.set_active_generation(str(chat.id), "orphan")
    await redis.hset("gen:orphan", mapping={"status": "streaming"})
    await redis.rpush("gen:orphan:tokens", "Partial answer")
    await generation.recover_interrupted_generations()
    async with sessions() as session:
        saved = await session.get(Message, msg.id)
        assert saved.status == MessageStatus.FAILED
        assert saved.content == "Partial answer"
    assert not await generation.is_generation_active(str(chat.id))


async def test_guest_can_retry_failed_answer(env, monkeypatch):
    from app.api.v1.endpoints import chats
    client, sessions, _ = env
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = {"Authorization": f"Bearer {guest['access_token']}"}
    chat_id = (await client.post("/api/v1/chats", json={}, headers=auth)).json()["id"]
    now = datetime.now(timezone.utc)
    async with sessions() as session:
        session.add(Message(chat_id=uuid.UUID(chat_id), role=MessageRole.USER, content="hello", created_at=now))
        answer = Message(chat_id=uuid.UUID(chat_id), role=MessageRole.ASSISTANT, status=MessageStatus.FAILED,
                         created_at=now + timedelta(microseconds=1))
        session.add(answer)
        await session.commit()
    monkeypatch.setattr(chats, "start_generation_task", MagicMock())
    response = await client.post(f"/api/v1/chats/{chat_id}/messages/{answer.id}/regenerate", headers=auth)
    assert response.status_code == 200, response.text
