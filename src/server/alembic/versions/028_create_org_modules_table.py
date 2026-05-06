"""Create org_modules table for per-organization module flags."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s025"
down_revision: Union[str, None] = "s024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "org_modules",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("module_id", sa.String(length=50), nullable=False),
        sa.Column("assigned_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "module_id", name="uq_org_modules_org_module"),
    )
    op.create_index("ix_org_modules_org_id", "org_modules", ["org_id"], unique=False)


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s025.")
