"""Add tags, description, updated_at to documents table."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s028"
down_revision: Union[str, None] = "s027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("tags", sa.JSON(), nullable=True))
    op.add_column("documents", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "documents",
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("documents", "updated_at")
    op.drop_column("documents", "description")
    op.drop_column("documents", "tags")
