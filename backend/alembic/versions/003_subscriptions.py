"""subscription tiers and stripe fields

Revision ID: 003
Revises: 002
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    subscriptiontier = sa.Enum("free", "pro", "premium", name="subscriptiontier")
    subscriptiontier.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column(
            "subscription_tier",
            subscriptiontier,
            nullable=False,
            server_default="free",
        ),
    )
    op.add_column(
        "users",
        sa.Column("stripe_customer_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("subscription_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "subscription_expires_at")
    op.drop_column("users", "stripe_subscription_id")
    op.drop_column("users", "stripe_customer_id")
    op.drop_column("users", "subscription_tier")
    sa.Enum(name="subscriptiontier").drop(op.get_bind(), checkfirst=True)
