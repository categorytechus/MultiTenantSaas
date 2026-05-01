from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Role


@dataclass
class AgentContext:
    org_id: UUID
    user_id: UUID
    session: AsyncSession
    role: Role
    task_id: UUID
