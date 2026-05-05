"""fix seeded membership roles

Revision ID: s019
Revises: s018
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s019"
down_revision: Union[str, None] = "s018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Normalize old seed role names to the app's Role enum values.
    op.execute(
        """
        UPDATE org_memberships
        SET role = CASE
          WHEN role = 'admin' THEN 'tenant_admin'
          WHEN role = 'member' THEN 'user'
          ELSE role
        END
        WHERE role IN ('admin', 'member');
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE org_memberships
        SET role = CASE
          WHEN role = 'tenant_admin' THEN 'admin'
          WHEN role = 'user' THEN 'member'
          ELSE role
        END
        WHERE role IN ('tenant_admin', 'user');
        """
    )
