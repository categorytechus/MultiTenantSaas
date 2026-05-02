from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action as _log_action
from app.core.tenancy import RequestContext
from app.models.audit_log import AuditLog
from app.core.logging import get_logger

logger = get_logger(__name__)


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
    Thin wrapper around core audit log insertion.
    """
    return await _log_action(
        session=session,
        ctx=ctx,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata=metadata,
        org_id=org_id,
        user_id=user_id,
    )
