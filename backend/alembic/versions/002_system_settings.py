"""system settings table

Revision ID: 002
Revises: 001
Create Date: 2026-08-11
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    # seed default daily limit
    op.execute(
        "INSERT INTO system_settings (key, value, updated_at) "
        "VALUES ('daily_message_limit', '30', NOW()) "
        "ON CONFLICT (key) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("system_settings")
