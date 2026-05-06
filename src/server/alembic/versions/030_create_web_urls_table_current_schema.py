"""Create web_urls table for current orgs schema."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s027"
down_revision: Union[str, None] = "s026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "web_urls",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("uploaded_by", sa.UUID(), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_web_urls_org_id", "web_urls", ["org_id"], unique=False)


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s027.")
