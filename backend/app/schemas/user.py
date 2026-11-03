from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, ConfigDict
from app.models.user import UserRole, SubscriptionTier


class UserBase(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: UserRole = UserRole.USER
    is_active: bool = True


class UserCreate(UserBase):
    password: str
    email: EmailStr


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[UserRole] = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_guest: bool
    subscription_tier: SubscriptionTier = SubscriptionTier.FREE
    daily_message_count: int
    last_message_date: Optional[datetime] = None
    created_at: datetime


class UserUsage(BaseModel):
    daily_limit: int
    used_today: int
    remaining: int
    resets_at: Optional[str] = None  # ISO date of next day
