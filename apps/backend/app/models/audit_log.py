from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID | None = Field(default=None, foreign_key="orgs.id")
    user_id: UUID | None = Field(default=None, foreign_key="users.id")
    action: str = Field(nullable=False)
    resource_type: str | None = Field(default=None)
    resource_id: str | None = Field(default=None)
    extra: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(sa.JSON, nullable=True),
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
