"""Add api_calling and report_generation master modules

Revision ID: s036
Revises: s035
Create Date: 2026-05-26

"""
from typing import Sequence, Union

from alembic import op


revision: str = 's036'
down_revision: Union[str, Sequence[str], None] = 's035'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO master_modules (id, name, enabled, created_at)
        VALUES
          ('api_calling',        'API Calling',        true, now()),
          ('report_generation',  'Report Generation',  true, now())
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM master_modules WHERE id IN ('api_calling', 'report_generation')"
    )
