"""User identity helpers (super-admin allow-list, JWT role aliases, email normalization)."""

from __future__ import annotations

from uuid import UUID

from app.core.config import settings
from app.core.rbac import Role

_DEFAULT_SUPER_IDS: tuple[str, ...] = ("99999999-9999-9999-9999-999999999999",)
_DB_SUPER_IDS: frozenset[UUID] = frozenset()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def super_admin_user_ids() -> frozenset[UUID]:
    """Bootstrap super-admin UUIDs from env `SUPER_ADMIN_USER_IDS` (comma-separated)."""
    raw = (getattr(settings, "SUPER_ADMIN_USER_IDS", "") or "").strip()
    if raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
    else:
        parts = list(_DEFAULT_SUPER_IDS)
    ids: list[UUID] = []
    for p in parts:
        try:
            ids.append(UUID(p))
        except ValueError:
            continue
    return frozenset(set(ids).union(_DB_SUPER_IDS))


def set_db_super_admin_user_ids(ids: frozenset[UUID]) -> None:
    """Called at startup to load DB-backed super admin allowlist."""
    global _DB_SUPER_IDS
    _DB_SUPER_IDS = ids


def is_super_admin_user(user_id: UUID) -> bool:
    return user_id in super_admin_user_ids()


def jwt_user_type_claim(user_id: UUID) -> str:
    return "super_admin" if is_super_admin_user(user_id) else "user"


def jwt_roles_claim(role: Role) -> list[str]:
    """Supplementary role strings embedded in JWT for UIs (sidebar, etc.)."""
    if role == Role.SUPER_ADMIN:
        return []
    if role == Role.TENANT_ADMIN:
        return ["org_admin"]
    return ["user"]
