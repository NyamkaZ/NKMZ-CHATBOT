from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field
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
    title: Optional[str] = "New Chat"
    channel: str = "web"


class ChatUpdate(BaseModel):
    title: Optional[str] = None


class ChatOut(ChatBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID] = None
    guest_id: Optional[str] = None
    is_title_generated: bool
    channel: str
    created_at: datetime
    updated_at: datetime
    messages: List[MessageOut] = []


class ChatListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    is_title_generated: bool
    updated_at: datetime
    last_message_preview: Optional[str] = None


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=32000)
    chat_id: Optional[UUID] = None  # if None, create new chat
    persona: Optional[str] = Field(
        None, max_length=32, description="Persona id: default, coder, tutor, creative, analyst"
    )


class SendMessageResponse(BaseModel):
    chat: ChatOut
    user_message: MessageOut
    assistant_message: MessageOut  # initially with status=thinking
    usage: Optional[dict] = None


class StreamEvent(BaseModel):
    event: str  # thinking, token, title, done, error, stopped
    data: dict
