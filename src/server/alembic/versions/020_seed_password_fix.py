"""normalize seed passwords

Revision ID: s017
Revises: s016
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s017"
down_revision: Union[str, None] = "s016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Plaintext for seeded users after this migration: Admin@123
_BCRYPT_ADMIN_123 = "$2b$12$KDpSnjKf3CaBQZw7xFN8V.hdzLZ5YVUbbwK7zsuOafJ1n9jhs4Hrm"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='users' AND column_name='hashed_password'
          ) THEN
            UPDATE users
            SET hashed_password = '{_BCRYPT_ADMIN_123}'
            WHERE email IN ('superadmin@multitenant.com', 'alice@acme.com', 'bob@acme.com', 'charlie@techstartup.io');
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='users' AND column_name='password_hash'
          ) THEN
            UPDATE users
            SET password_hash = '{_BCRYPT_ADMIN_123}'
            WHERE email IN ('superadmin@multitenant.com', 'alice@acme.com', 'bob@acme.com', 'charlie@techstartup.io');
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # No reliable prior hash recovery.
    pass
