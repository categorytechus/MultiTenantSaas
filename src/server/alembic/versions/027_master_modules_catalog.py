"""Create master_modules catalog and seed default modules."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s024"
down_revision: Union[str, None] = "s023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "master_modules",
        sa.Column("id", sa.String(length=50), nullable=False, primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.execute(
        """
        INSERT INTO master_modules (id, name, enabled, created_at)
        VALUES
          ('ai_assistant', 'AI Assistant', true, NOW()),
          ('documents', 'Documents', true, NOW()),
          ('web_urls', 'Web URLs', true, NOW())
        ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              enabled = EXCLUDED.enabled;
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s024.")

