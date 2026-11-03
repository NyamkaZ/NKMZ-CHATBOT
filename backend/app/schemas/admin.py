from typing import Optional, List
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class SystemStatus(BaseModel):
    status: str
    postgres: str
    redis: str
    ollama: str
    ollama_model: Optional[str] = None
    uptime_seconds: Optional[float] = None


class ModelHealth(BaseModel):
    name: str
    available: bool
    size: Optional[str] = None
    details: Optional[dict] = None


class AnalyticsSummary(BaseModel):
    total_users: int
    active_users_today: int
    total_chats: int
    total_messages: int
    messages_today: int
    guest_conversions: int


class UsageLimitUpdate(BaseModel):
    daily_message_limit: int


class UserAdminOut(BaseModel):
    id: UUID
    email: Optional[str]
    full_name: Optional[str]
    role: str
    is_active: bool
    is_guest: bool
    daily_message_count: int
    created_at: datetime
    chat_count: int = 0
