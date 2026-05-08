"""invite_tokens, multi-org memberships, refresh token org scope

Revision ID: s020
Revises: s019
Create Date: 2026-05-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s020"
down_revision: Union[str, None] = "s019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("org_memberships_user_id_key", "org_memberships", type_="unique")
    op.create_index(
        "uq_org_memberships_user_org",
        "org_memberships",
        ["user_id", "org_id"],
        unique=True,
    )

    op.create_table(
        "invite_tokens",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="user"),
        sa.Column("invited_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_invite_tokens_token", "invite_tokens", ["token"], unique=True)
    op.create_index("ix_invite_tokens_email", "invite_tokens", ["email"])
    op.create_index("ix_invite_tokens_org_id", "invite_tokens", ["org_id"])

    op.add_column("refresh_tokens", sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=True))
    op.add_column(
        "refresh_tokens",
        sa.Column("no_org_scope", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s020 (may lose multi-org rows).")
