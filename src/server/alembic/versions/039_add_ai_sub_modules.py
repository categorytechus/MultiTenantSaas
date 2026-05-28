"""Add ai_images and ai_links as AI Assistant sub-modules

Revision ID: s037
Revises: s036
Create Date: 2026-05-28

"""
from typing import Sequence, Union

from alembic import op


revision: str = 's037'
down_revision: Union[str, Sequence[str], None] = 's036'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO master_modules (id, name, enabled, created_at)
        VALUES
          ('ai_images', 'Images', true, now()),
          ('ai_links',  'Links',  true, now())
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM master_modules WHERE id IN ('ai_images', 'ai_links')"
    )
