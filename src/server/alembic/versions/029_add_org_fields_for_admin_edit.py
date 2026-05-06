"""Add org domain/status/subscription_tier fields."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s026"
down_revision: Union[str, None] = "s025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orgs", sa.Column("domain", sa.String(length=255), nullable=True))
    op.add_column(
        "orgs",
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'active'")),
    )
    op.add_column(
        "orgs",
        sa.Column(
            "subscription_tier",
            sa.String(length=50),
            nullable=False,
            server_default=sa.text("'free'"),
        ),
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s026.")
