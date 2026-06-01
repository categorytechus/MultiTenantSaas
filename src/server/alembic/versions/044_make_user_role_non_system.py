"""Make the built-in 'user' role non-system so it can be edited and deleted.

The 'user' role was seeded in migration s022 with is_system=TRUE, which
prevents tenant admins from editing or deleting it via the roles API.
This migration flips is_system to FALSE so it is treated like a regular
org-visible default role rather than a protected system role.

Revision ID: s042
Revises: s041
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "s042"
down_revision: Union[str, None] = "s041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_USER_ROLE_ID = "f3333333-3333-3333-3333-333333333333"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE roles
        SET is_system = FALSE
        WHERE id = '{_USER_ROLE_ID}'
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        UPDATE roles
        SET is_system = TRUE
        WHERE id = '{_USER_ROLE_ID}'
        """
    )
