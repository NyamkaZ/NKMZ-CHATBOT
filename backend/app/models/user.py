import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, Integer, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.core.database import Base


class UserRole(str, enum.Enum):
    GUEST = "guest"
    USER = "user"
    ADMIN = "admin"


class SubscriptionTier(str, enum.Enum):
    FREE = "free"
    PRO = "pro"
    PREMIUM = "premium"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole), default=UserRole.USER, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False)
    guest_id: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)

    subscription_tier: Mapped[SubscriptionTier] = mapped_column(
        SAEnum(SubscriptionTier, values_callable=lambda enum: [item.value for item in enum]),
        default=SubscriptionTier.FREE, nullable=False
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subscription_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bumped whenever the password changes; access tokens carry the value they
    # were issued with, so older sessions stop working.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bumped whenever the password changes; access tokens carry the value they
    # were issued with, so older sessions stop working.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Usage tracking (also mirrored in Redis for speed)
    daily_message_count: Mapped[int] = mapped_column(Integer, default=0)
    last_message_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    chats: Mapped[list["Chat"]] = relationship("Chat", back_populates="user", cascade="all, delete-orphan")

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    def __repr__(self) -> str:
        return f"<User {self.email or self.guest_id}>"
