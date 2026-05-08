"""Add API permission keys used by FastAPI authorize() guards."""

from typing import Sequence, Union

from alembic import op

revision: str = "s023"
down_revision: Union[str, None] = "s022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ORG_ADMIN_ROLE_ID = "e2222222-2222-2222-2222-222222222222"
_USER_ROLE_ID = "f3333333-3333-3333-3333-333333333333"

_EXTRA_PERMS = {
    "users:read": "90000000-0000-0000-0000-000000000001",
    "users:invite": "90000000-0000-0000-0000-000000000002",
    "users:update": "90000000-0000-0000-0000-000000000003",
    "agents:read": "90000000-0000-0000-0000-000000000004",
    "agents:execute": "90000000-0000-0000-0000-000000000005",
    "audit_logs:read": "90000000-0000-0000-0000-000000000006",
    "tenants:update": "90000000-0000-0000-0000-000000000007",
}


def upgrade() -> None:
    rows = []
    for key, pid in _EXTRA_PERMS.items():
        resource, action = key.split(":", 1)
        rows.append(
            f"('{pid}'::uuid, '{resource}', '{action}', '{resource} {action} permission', NOW())"
        )
    op.execute(
        f"""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
        {', '.join(rows)}
        ON CONFLICT (id) DO NOTHING;
        """
    )

    # org_admin gets all extra perms
    op.execute(
        f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        SELECT gen_random_uuid(), '{_ORG_ADMIN_ROLE_ID}'::uuid, p.id, NOW()
        FROM permissions p
        WHERE p.id IN ({', '.join([f"'{v}'::uuid" for v in _EXTRA_PERMS.values()])})
        ON CONFLICT DO NOTHING;
        """
    )

    # user gets agents + minimal documents are already seeded in s022
    user_ids = [_EXTRA_PERMS["agents:read"], _EXTRA_PERMS["agents:execute"]]
    op.execute(
        f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        SELECT gen_random_uuid(), '{_USER_ROLE_ID}'::uuid, p.id, NOW()
        FROM permissions p
        WHERE p.id IN ({', '.join([f"'{v}'::uuid" for v in user_ids])})
        ON CONFLICT DO NOTHING;
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s023.")

