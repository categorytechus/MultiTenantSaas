"""add document metadata columns

Revision ID: 003
Revises: 002
Create Date: 2026-05-04

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("extracted_title", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("keywords", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "keywords")
    op.drop_column("documents", "summary")
    op.drop_column("documents", "extracted_title")
