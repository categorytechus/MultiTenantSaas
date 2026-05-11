"""Convert documents.tags to jsonb and add GIN index for role filtering."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s030"
down_revision: Union[str, None] = "s029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE documents ALTER COLUMN tags TYPE jsonb USING tags::jsonb"
    )
    op.create_index(
        "ix_documents_tags_gin",
        "documents",
        ["tags"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_documents_tags_gin", table_name="documents")
    op.execute(
        "ALTER TABLE documents ALTER COLUMN tags TYPE json USING tags::json"
    )
