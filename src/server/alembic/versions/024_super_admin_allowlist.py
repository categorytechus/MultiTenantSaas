"""super admin allowlist table

Revision ID: s021
Revises: s020
Create Date: 2026-05-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s021"
down_revision: Union[str, None] = "s020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "super_admin_allowlist",
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # Seed the default dev super admin UUID, if that user exists.
    op.execute(
        """
        INSERT INTO super_admin_allowlist (user_id, status)
        SELECT u.id, 'active'
        FROM users u
        WHERE u.id = '99999999-9999-9999-9999-999999999999'
        ON CONFLICT (user_id) DO NOTHING;
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s021.")

