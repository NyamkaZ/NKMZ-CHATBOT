from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from uuid import UUID


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: Optional[str] = None
    role: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    full_name: Optional[str] = None


class GuestSession(BaseModel):
    guest_id: str
    access_token: Optional[str] = None
