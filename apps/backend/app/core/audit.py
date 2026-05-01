from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.core.tenancy import RequestContext


async def log_action(
    session: AsyncSession,
    ctx: RequestContext | None,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    org_id: UUID | None = None,
    user_id: UUID | None = None,
) -> AuditLog:
    """
    Insert an AuditLog row.
    If ctx is provided, org_id and user_id are taken from it (unless overridden).
    """
    effective_org_id = org_id or (ctx.org_id if ctx else None)
    effective_user_id = user_id or (ctx.user_id if ctx else None)

    audit_log = AuditLog(
        org_id=effective_org_id,
        user_id=effective_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else None,
        extra=metadata or {},
    )
    session.add(audit_log)
    await session.flush()
    return audit_log
