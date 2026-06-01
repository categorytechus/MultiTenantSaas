"""Add recovery_key_hash to super_admin_allowlist.

Super admins can generate a recovery key when changing their password.
The key is stored hashed and can be used to log in if they forget their password.

Revision ID: s041
Revises: s040
Create Date: 2026-06-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s041"
down_revision: Union[str, Sequence[str], None] = "s040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "super_admin_allowlist",
        sa.Column("recovery_key_hash", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("super_admin_allowlist", "recovery_key_hash")
