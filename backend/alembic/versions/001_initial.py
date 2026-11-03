"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-08-11
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=True, index=True),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("role", sa.Enum("GUEST", "USER", "ADMIN", name="userrole"), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("is_guest", sa.Boolean(), default=False),
        sa.Column("guest_id", sa.String(64), unique=True, nullable=True, index=True),
        sa.Column("daily_message_count", sa.Integer(), default=0),
        sa.Column("last_message_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("guest_id", sa.String(64), nullable=True, index=True),
        sa.Column("title", sa.String(255), default="New Chat"),
        sa.Column("is_title_generated", sa.Boolean(), default=False),
        sa.Column("channel", sa.String(32), default="web"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.Enum("USER", "ASSISTANT", "SYSTEM", name="messagerole"), nullable=False),
        sa.Column("content", sa.Text(), default=""),
        sa.Column("status", sa.Enum("PENDING", "THINKING", "STREAMING", "COMPLETED", "STOPPED", "FAILED", name="messagestatus"), nullable=False),
        sa.Column("generation_id", sa.String(64), nullable=True, index=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("model_name", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("original_name", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=True),
        sa.Column("file_size", sa.Integer(), default=0),
        sa.Column("chunk_count", sa.Integer(), default=0),
        sa.Column("is_indexed", sa.Boolean(), default=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("documents")
    op.drop_table("messages")
    op.drop_table("chats")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS messagestatus")
    op.execute("DROP TYPE IF EXISTS messagerole")
    op.execute("DROP TYPE IF EXISTS userrole")
