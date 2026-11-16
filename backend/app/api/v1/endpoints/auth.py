import hashlib
import hmac
import ipaddress
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status, Header
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.chat import Chat
from app.models.auth_token import AuthToken, PURPOSE_RESET, PURPOSE_VERIFY
from app.schemas.auth import (
    Token, UserLogin, UserRegister, GuestSession, ProfileUpdate, PasswordChange,
    ForgotPassword, ResetPassword, EmailToken,
)
from app.services import email as mailer
from app.schemas.user import UserOut
from app.api.v1.deps import get_current_user_optional, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_MAX_FAILURES = 8
LOGIN_LOCK_SECONDS = 15 * 60


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _by_email(email: str):
    # Accounts created before normalization may contain capitals.
    return func.lower(User.email) == email


async def _login_failures(subject: str, *, record: bool = False, clear: bool = False) -> int:
    """Failed-attempt counter per account. A Redis outage must not block sign-in."""
    try:
        from app.core.redis import get_redis
        redis = await get_redis()
        key = f"login_fail:{subject}"
        if clear:
            await redis.delete(key)
            return 0
        if record:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, LOGIN_LOCK_SECONDS)
            return int(count)
        return int(await redis.get(key) or 0)
    except Exception:
        return 0


async def _allow(key: str, limit: int, window_seconds: int) -> bool:
    """Count an attempt; False once `limit` is exceeded within the window."""
    try:
        from app.core.redis import get_redis
        redis = await get_redis()
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
        return int(count) <= limit
    except Exception:
        return True


def _session_token(user: User) -> str:
    return create_access_token(
        subject=str(user.id),
        extra_claims={"role": user.role.value, "ver": user.token_version or 0},
    )


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _issue_mail_token(db: AsyncSession, user: User, purpose: str, lifetime: timedelta) -> str:
    """Create a single-use token; any earlier unused one for the same purpose stops working."""
    now = datetime.now(timezone.utc)
    await db.execute(
        update(AuthToken)
        .where(AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None))
        .values(used_at=now)
    )
    raw = secrets.token_urlsafe(32)
    db.add(AuthToken(user_id=user.id, purpose=purpose, token_hash=_hash_token(raw), expires_at=now + lifetime))
    return raw


async def _redeem_mail_token(db: AsyncSession, raw: str, purpose: str) -> Optional[User]:
    """Mark the token used and return its user, or None if it is unknown, used or expired."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(AuthToken).where(AuthToken.token_hash == _hash_token(raw), AuthToken.purpose == purpose).with_for_update()
    )
    token = result.scalar_one_or_none()
    if not token or token.used_at is not None:
        return None
    expires = token.expires_at if token.expires_at.tzinfo else token.expires_at.replace(tzinfo=timezone.utc)
    if expires < now:
        return None
    token.used_at = now
    user = (await db.execute(select(User).where(User.id == token.user_id))).scalar_one_or_none()
    if not user or not user.is_active or user.is_guest:
        return None
    return user


async def _queue_verification(db: AsyncSession, user: User, background: BackgroundTasks) -> None:
    raw = await _issue_mail_token(db, user, PURPOSE_VERIFY, timedelta(hours=settings.EMAIL_VERIFY_HOURS))
    subject, body = mailer.verify_email(f"{settings.FRONTEND_URL}/verify-email?token={raw}", settings.EMAIL_VERIFY_HOURS)
    background.add_task(mailer.send_email, user.email, subject, body)


@router.post("/register", response_model=Token)
async def register(
    data: UserRegister,
    background: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_guest_id: Annotated[Optional[str], Header(alias="X-Guest-Id")] = None,
):
    email = _normalize_email(data.email)
    result = await db.execute(select(User).where(_by_email(email)))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        role=UserRole.USER,
        is_guest=False,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # Two simultaneous registrations for the same address.
        await db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")

    # Link any guest chats + track conversion
    if x_guest_id:
        guest_result = await db.execute(select(User).where(
            User.guest_id == x_guest_id, User.is_guest.is_(True), User.is_active.is_(True)
        ).with_for_update())
        guest = guest_result.scalar_one_or_none()
        if guest:
            await db.execute(
                Chat.__table__.update()
                .where(Chat.guest_id == x_guest_id)
                .values(user_id=user.id, guest_id=None)
            )
            guest.is_active = False
        try:
            from app.core.redis import get_redis
            redis = await get_redis()
            await redis.incr("stats:guest_conversions")
        except Exception:
            pass

    await _queue_verification(db, user, background)
    await db.commit()
    await db.refresh(user)
    return Token(access_token=_session_token(user))


@router.post("/login", response_model=Token)
async def login(
    data: UserLogin,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_guest_id: Annotated[Optional[str], Header(alias="X-Guest-Id")] = None,
):
    email = _normalize_email(data.email)
    if await _login_failures(email) >= LOGIN_MAX_FAILURES:
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Please try again in 15 minutes.",
        )
    result = await db.execute(select(User).where(_by_email(email)).order_by(User.created_at))
    user = result.scalars().first()
    if not user or not user.hashed_password or not verify_password(data.password, user.hashed_password):
        await _login_failures(email, record=True)
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    await _login_failures(email, clear=True)
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    # Link guest chats on login
    if x_guest_id:
        guest_result = await db.execute(select(User).where(
            User.guest_id == x_guest_id, User.is_guest.is_(True), User.is_active.is_(True)
        ).with_for_update())
        guest = guest_result.scalar_one_or_none()
        result_chats = await db.execute(
            select(Chat).where(Chat.guest_id == x_guest_id)
        )
        guest_chats = result_chats.scalars().all()
        if guest and guest_chats:
            await db.execute(
                Chat.__table__.update()
                .where(Chat.guest_id == x_guest_id)
                .values(user_id=user.id, guest_id=None)
            )
            try:
                from app.core.redis import get_redis
                redis = await get_redis()
                await redis.incr("stats:guest_conversions")
            except Exception:
                pass
        if guest:
            guest.is_active = False
        await db.commit()

    return Token(access_token=_session_token(user))


def internal_client_token() -> str:
    """Shared proof for first-party services (the bots) that read the same .env."""
    return hmac.new(settings.SECRET_KEY.encode(), b"nkmz-internal-client", hashlib.sha256).hexdigest()


def _parse_ip(address: str):
    """An ip_address, with IPv4-mapped IPv6 (::ffff:1.2.3.4) folded to IPv4; None if invalid."""
    try:
        ip = ipaddress.ip_address(address.strip())
    except ValueError:
        return None
    return getattr(ip, "ipv4_mapped", None) or ip


def _is_private(ip) -> bool:
    return ip is not None and (ip.is_private or ip.is_loopback)


def client_ip(request: Request) -> str:
    """
    The address a request really came from. X-Forwarded-For is only believed
    when the direct peer is one of our own proxies (a private address), and
    then the right-most public entry is used: anything further left was
    supplied by the client and can be forged.
    """
    raw_peer = request.client.host if request.client else "unknown"
    peer = _parse_ip(raw_peer)
    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded or not _is_private(peer):
        return str(peer) if peer else raw_peer
    hops = [ip for ip in (_parse_ip(hop) for hop in forwarded.split(",")) if ip is not None]
    for hop in reversed(hops):
        if not _is_private(hop):
            return str(hop)
    return str(hops[-1]) if hops else str(peer)


async def _limit_guest_sessions(request: Request) -> None:
    """Without this, a new guest session is a fresh free quota on every call."""
    limit = settings.GUEST_SESSIONS_PER_IP_PER_HOUR
    if limit <= 0:
        return
    supplied = request.headers.get("x-internal-token")
    if supplied and hmac.compare_digest(supplied, internal_client_token()):
        return  # bots create one session per chat user from a single address
    try:
        from app.core.redis import get_redis
        redis = await get_redis()
        key = f"guest_ip:{client_ip(request)}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 3600)
        if count <= limit:
            return
        ttl = await redis.ttl(key)
    except Exception:
        return  # a Redis outage must not block visitors
    raise HTTPException(
        status_code=429,
        detail="Too many guest sessions from this network. Please sign in or try again later.",
        headers={"Retry-After": str(ttl if ttl and ttl > 0 else 3600)},
    )


@router.post("/guest", response_model=GuestSession)
async def create_guest_session(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _limit_guest_sessions(request)
    guest_id = str(uuid.uuid4())
    user = User(
        guest_id=guest_id,
        role=UserRole.GUEST,
        is_guest=True,
        is_active=True,
        full_name="Guest",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Guests also get a short-lived token for convenience
    token = create_access_token(
        subject=str(user.id),
        expires_delta=timedelta(hours=24),
        extra_claims={"role": "guest", "guest_id": guest_id},
    )
    return GuestSession(guest_id=guest_id, access_token=token)


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_user)]):
    return user


@router.patch("/me", response_model=UserOut)
async def update_profile(
    data: ProfileUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if user.is_guest:
        raise HTTPException(status_code=403, detail="Sign in to edit your profile")
    user.full_name = data.full_name or None
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/change-password", response_model=Token)
async def change_password(
    data: PasswordChange,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if user.is_guest or not user.hashed_password:
        raise HTTPException(status_code=403, detail="Sign in to change your password")
    throttle = f"password:{user.id}"
    if await _login_failures(throttle) >= LOGIN_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many attempts. Please try again in 15 minutes.")
    if not verify_password(data.current_password, user.hashed_password):
        await _login_failures(throttle, record=True)
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if data.new_password == data.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current one")
    await _login_failures(throttle, clear=True)
    user.hashed_password = get_password_hash(data.new_password)
    # Sign out every other device; this one continues with the token returned here.
    user.token_version = (user.token_version or 0) + 1
    await db.commit()
    return Token(access_token=_session_token(user))


FORGOT_MESSAGE = "If an account exists for this email, a reset link has been sent."


@router.post("/forgot-password")
async def forgot_password(
    data: ForgotPassword,
    request: Request,
    background: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Always answers the same way, so it cannot be used to find registered addresses."""
    email = _normalize_email(data.email)
    allowed = await _allow(f"forgot:{email}", 3, 3600) and await _allow(f"forgot_ip:{client_ip(request)}", 10, 3600)
    if allowed:
        result = await db.execute(select(User).where(_by_email(email)).order_by(User.created_at))
        user = result.scalars().first()
        if user and user.is_active and not user.is_guest and user.hashed_password:
            raw = await _issue_mail_token(db, user, PURPOSE_RESET, timedelta(minutes=settings.PASSWORD_RESET_MINUTES))
            await db.commit()
            subject, body = mailer.reset_email(
                f"{settings.FRONTEND_URL}/reset-password?token={raw}", settings.PASSWORD_RESET_MINUTES
            )
            # Sent after the response, so timing does not reveal whether the account exists.
            background.add_task(mailer.send_email, user.email, subject, body)
    return {"message": FORGOT_MESSAGE}


@router.post("/reset-password", status_code=204)
async def reset_password(
    data: ResetPassword,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user = await _redeem_mail_token(db, data.token, PURPOSE_RESET)
    if not user:
        await db.rollback()
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    user.hashed_password = get_password_hash(data.new_password)
    user.token_version = (user.token_version or 0) + 1  # sign out everywhere
    # Opening the link proves control of the mailbox.
    user.email_verified_at = user.email_verified_at or datetime.now(timezone.utc)
    await db.commit()
    if user.email:
        await _login_failures(_normalize_email(user.email), clear=True)


@router.post("/verify-email", status_code=204)
async def verify_email(
    data: EmailToken,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user = await _redeem_mail_token(db, data.token, PURPOSE_VERIFY)
    if not user:
        await db.rollback()
        raise HTTPException(status_code=400, detail="This confirmation link is invalid or has expired.")
    user.email_verified_at = user.email_verified_at or datetime.now(timezone.utc)
    await db.commit()


@router.post("/resend-verification")
async def resend_verification(
    background: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if user.is_guest or not user.email:
        raise HTTPException(status_code=403, detail="Sign in to confirm your email")
    if user.email_verified_at:
        return {"message": "Email already confirmed", "sent": False}
    if not await _allow(f"verify_mail:{user.id}", 3, 3600):
        raise HTTPException(
            status_code=429,
            detail="A confirmation email was sent recently. Please check your inbox or try again later.",
            headers={"Retry-After": "3600"},
        )
    await _queue_verification(db, user, background)
    await db.commit()
    return {"message": "Confirmation email sent", "sent": True}
