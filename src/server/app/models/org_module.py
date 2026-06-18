from datetime import datetime, timezone
from uuid import UUID, uuid4

from typing import Any
from sqlmodel import Field, SQLModel, Column, JSON


class OrgModule(SQLModel, table=True):
    __tablename__ = "org_modules"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", ondelete="CASCADE", nullable=False, index=True)
    module_id: str = Field(nullable=False, max_length=50, index=True)
    assigned_by: UUID | None = Field(default=None, foreign_key="users.id", ondelete="SET NULL")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
