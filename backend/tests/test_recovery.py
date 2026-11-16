import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.security import create_access_token, get_password_hash
from app.models import AuthToken, User
from app.services import email as mailer
from conftest import make_user, headers


@pytest.fixture
def outbox(monkeypatch):
    """Capture account email instead of sending it."""
    sent = []

    async def capture(to, subject, body):
        sent.append({"to": to, "subject": subject, "body": body})
        return True

    monkeypatch.setattr(mailer, "send_email", capture)
    return sent


def link_token(message):
    return re.search(r"token=([\w-]+)", message["body"]).group(1)


async def login(client, email, password):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def test_forgot_password_resets_and_signs_out_other_sessions(env, outbox):
    client, sessions, redis = env
    user = await make_user(sessions, email="lost@example.com", hashed_password=get_password_hash("old-password"))
    for _ in range(3):
        await login(client, "lost@example.com", "guess")  # failed attempts before the reset

    asked = await client.post("/api/v1/auth/forgot-password", json={"email": "Lost@Example.com"})
    assert asked.status_code == 200
    assert [m["to"] for m in outbox] == ["lost@example.com"]
    token = link_token(outbox[0])
    assert "/reset-password?token=" in outbox[0]["body"]
    async with sessions() as session:
        stored = (await session.execute(select(AuthToken))).scalars().all()
        assert len(stored) == 1 and stored[0].token_hash != token  # only a hash is kept

    short = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "abc"})
    assert short.status_code == 422
    done = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "new-password"})
    assert done.status_code == 204, done.text

    assert (await login(client, "lost@example.com", "old-password")).status_code == 401
    assert (await login(client, "lost@example.com", "new-password")).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=headers(user))).status_code == 401  # old session
    assert await redis.get("login_fail:lost@example.com") is None
    async with sessions() as session:
        assert (await session.get(User, user.id)).email_verified_at is not None

    again = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "third-password"})
    assert again.status_code == 400  # single use
    assert (await login(client, "lost@example.com", "new-password")).status_code == 200


async def test_forgot_password_does_not_reveal_accounts(env, outbox):
    client, sessions, _ = env
    await make_user(sessions, email="real@example.com", hashed_password=get_password_hash("some-password"))
    async with sessions() as session:
        session.add(User(email="off@example.com", hashed_password=get_password_hash("some-password"), is_active=False))
        await session.commit()
    known = await client.post("/api/v1/auth/forgot-password", json={"email": "real@example.com"})
    unknown = await client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    disabled = await client.post("/api/v1/auth/forgot-password", json={"email": "off@example.com"})
    assert known.status_code == unknown.status_code == disabled.status_code == 200
    assert known.json() == unknown.json() == disabled.json()
    assert [m["to"] for m in outbox] == ["real@example.com"]


async def test_reset_requests_are_limited_and_only_the_newest_link_works(env, outbox):
    client, sessions, _ = env
    await make_user(sessions, email="busy@example.com", hashed_password=get_password_hash("old-password"))
    for _ in range(5):
        assert (await client.post("/api/v1/auth/forgot-password", json={"email": "busy@example.com"})).status_code == 200
    assert len(outbox) == 3  # three per hour per address, silently
    first, newest = link_token(outbox[0]), link_token(outbox[-1])
    stale = await client.post("/api/v1/auth/reset-password", json={"token": first, "new_password": "new-password"})
    assert stale.status_code == 400
    fresh = await client.post("/api/v1/auth/reset-password", json={"token": newest, "new_password": "new-password"})
    assert fresh.status_code == 204


async def test_expired_and_wrong_purpose_links_are_refused(env, outbox):
    client, sessions, _ = env
    user = await make_user(sessions, email="late@example.com", hashed_password=get_password_hash("old-password"))
    await client.post("/api/v1/auth/forgot-password", json={"email": "late@example.com"})
    token = link_token(outbox[0])
    # A reset link cannot confirm an address.
    assert (await client.post("/api/v1/auth/verify-email", json={"token": token})).status_code == 400
    async with sessions() as session:
        stored = (await session.execute(select(AuthToken).where(AuthToken.user_id == user.id))).scalar_one()
        stored.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()
    expired = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "new-password"})
    assert expired.status_code == 400
    assert (await login(client, "late@example.com", "old-password")).status_code == 200
    unknown = await client.post("/api/v1/auth/reset-password", json={"token": "x" * 43, "new_password": "new-password"})
    assert unknown.status_code == 400


async def test_registration_sends_a_confirmation_link(env, outbox):
    client, _, _ = env
    registered = await client.post("/api/v1/auth/register", json={"email": "new@example.com", "password": "test-password"})
    assert registered.status_code == 200, registered.text
    auth_header = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    assert (await client.get("/api/v1/auth/me", headers=auth_header)).json()["email_verified"] is False
    assert len(outbox) == 1 and "/verify-email?token=" in outbox[0]["body"]

    resent = await client.post("/api/v1/auth/resend-verification", headers=auth_header)
    assert resent.status_code == 200 and resent.json()["sent"] is True
    # The first link was replaced by the second.
    assert (await client.post("/api/v1/auth/verify-email", json={"token": link_token(outbox[0])})).status_code == 400
    assert (await client.post("/api/v1/auth/verify-email", json={"token": link_token(outbox[1])})).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=auth_header)).json()["email_verified"] is True
    assert (await client.post("/api/v1/auth/resend-verification", headers=auth_header)).json()["sent"] is False


async def test_resend_is_limited_and_closed_to_guests(env, outbox):
    client, sessions, _ = env
    user = await make_user(sessions, email="again@example.com", hashed_password=get_password_hash("some-password"))
    codes = [(await client.post("/api/v1/auth/resend-verification", headers=headers(user))).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    guest = (await client.post("/api/v1/auth/guest")).json()
    refused = await client.post("/api/v1/auth/resend-verification", headers={"Authorization": f"Bearer {guest['access_token']}"})
    assert refused.status_code == 403


async def test_tokens_without_a_version_keep_working_until_the_password_changes(env):
    client, sessions, _ = env
    user = await make_user(sessions, email="legacy@example.com", hashed_password=get_password_hash("old-password"))
    legacy = {"Authorization": f"Bearer {create_access_token(user.id)}"}  # issued before versioning
    assert (await client.get("/api/v1/auth/me", headers=legacy)).status_code == 200
    malformed = create_access_token(user.id, extra_claims={"ver": "x"})
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {malformed}"})).status_code == 401
    assert (await client.get("/api/v1/stream/none", params={"token": malformed})).status_code == 401


async def test_mail_failures_never_break_the_request(env, monkeypatch):
    client, sessions, _ = env
    await make_user(sessions, email="smtp@example.com", hashed_password=get_password_hash("some-password"))
    monkeypatch.setattr(mailer.settings, "SMTP_HOST", "smtp.invalid")
    monkeypatch.setattr(mailer.settings, "SMTP_FROM", "NKMZ <no-reply@example.com>")

    def explode(*args):
        raise OSError("connection refused")

    monkeypatch.setattr(mailer, "_send_sync", explode)
    assert await mailer.send_email("smtp@example.com", "s", "b") is False
    assert (await client.post("/api/v1/auth/forgot-password", json={"email": "smtp@example.com"})).status_code == 200
