"""delete users with no org memberships (orphaned users)

Revision ID: 052
Revises: 051
Create Date: 2026-06-10

"""
from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None

_orphan_subq = """
    SELECT id FROM users
    WHERE id NOT IN (SELECT user_id FROM org_memberships)
    AND id NOT IN (SELECT user_id FROM super_admin_allowlist)
"""


def upgrade():
    op.execute(f"DELETE FROM oauth_identities WHERE user_id IN ({_orphan_subq})")
    op.execute(f"DELETE FROM refresh_tokens WHERE user_id IN ({_orphan_subq})")
    op.execute(f"DELETE FROM users WHERE id IN ({_orphan_subq})")


def downgrade():
    pass  # data deletion is not reversible
