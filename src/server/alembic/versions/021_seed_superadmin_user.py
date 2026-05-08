"""seed superadmin login user

Revision ID: s018
Revises: s017
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s018"
down_revision: Union[str, None] = "s017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Plaintext password for seeded superadmin: Admin@123
_BCRYPT_ADMIN_123 = "$2b$12$KDpSnjKf3CaBQZw7xFN8V.hdzLZ5YVUbbwK7zsuOafJ1n9jhs4Hrm"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
          IF to_regclass('public.orgs') IS NOT NULL THEN
            INSERT INTO users (id, email, hashed_password, name, created_at)
            VALUES (
              '99999999-9999-9999-9999-999999999999',
              'superadmin@multitenant.com',
              '{_BCRYPT_ADMIN_123}',
              'Super Admin',
              NOW()
            )
            ON CONFLICT (email) DO UPDATE
              SET hashed_password = EXCLUDED.hashed_password,
                  name = EXCLUDED.name;

            INSERT INTO org_memberships (id, user_id, org_id, role, created_at)
            VALUES (
              '99999999-1111-1111-1111-999999999999',
              '99999999-9999-9999-9999-999999999999',
              '11111111-1111-1111-1111-111111111111',
              'tenant_admin',
              NOW()
            )
            ON CONFLICT (id) DO NOTHING;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM org_memberships
        WHERE id = '99999999-1111-1111-1111-999999999999';
        """
    )
    op.execute(
        """
        DELETE FROM users
        WHERE id = '99999999-9999-9999-9999-999999999999';
        """
    )
