from pydantic import BaseModel, EmailStr, Field, field_validator
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
    full_name: Optional[str] = Field(None, max_length=255)

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, password: str) -> str:
        if len(password.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes")
        return password


def _password_bytes(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 UTF-8 bytes")
    return password


class ProfileUpdate(BaseModel):
    full_name: str = Field(..., max_length=255)

    @field_validator("full_name")
    @classmethod
    def tidy_name(cls, name: str) -> str:
        return " ".join(name.split())


class PasswordChange(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., min_length=6)

    _new_password_bytes = field_validator("new_password")(_password_bytes)


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)
    new_password: str = Field(..., min_length=6)

    _new_password_bytes = field_validator("new_password")(_password_bytes)


class EmailToken(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)
    new_password: str = Field(..., min_length=6)

    _new_password_bytes = field_validator("new_password")(_password_bytes)


class EmailToken(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)


class GuestSession(BaseModel):
    guest_id: str
    access_token: Optional[str] = None
