from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.chat import MessageRole, MessageStatus


class MessageBase(BaseModel):
    role: MessageRole
    content: str = ""


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=32000)


class MessageOut(MessageBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    chat_id: UUID
    status: MessageStatus
    generation_id: Optional[str] = None
    error_message: Optional[str] = None
    token_count: Optional[int] = None
    model_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ChatBase(BaseModel):
    title: str = "New Chat"


class ChatCreate(BaseModel):
    title: Optional[str] = Field("New Chat", max_length=255)
    channel: str = Field("web", max_length=32)


class ChatUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    is_pinned: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, title: Optional[str]) -> Optional[str]:
        if title is not None and not title.strip():
            raise ValueError("Title cannot be blank")
        return title.strip() if title is not None else None


class ChatOut(ChatBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID] = None
    guest_id: Optional[str] = None
    is_title_generated: bool
    is_pinned: bool = False
    channel: str
    created_at: datetime
    updated_at: datetime
    messages: List[MessageOut] = []


class ChatListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    is_title_generated: bool
    is_pinned: bool = False
    updated_at: datetime
    last_message_preview: Optional[str] = None


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=32000)
    chat_id: Optional[UUID] = None  # if None, create new chat
    persona: Optional[str] = Field(
        None, max_length=32, description="Persona id: default, coder, tutor, creative, analyst"
    )

    @field_validator("content")
    @classmethod
    def content_not_blank(cls, content: str) -> str:
        if not content.strip():
            raise ValueError("Message cannot be blank")
        return content


class SendMessageResponse(BaseModel):
    chat: ChatOut
    user_message: MessageOut
    assistant_message: MessageOut  # initially with status=thinking
    usage: Optional[dict] = None


class RegenerateMessageRequest(BaseModel):
    persona: Optional[str] = Field(None, max_length=32)


class StreamEvent(BaseModel):
    event: str  # thinking, token, title, done, error, stopped
    data: dict
