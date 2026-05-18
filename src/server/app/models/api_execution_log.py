from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class ApiExecutionLog(SQLModel, table=True):
    __tablename__ = "api_execution_logs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False, index=True)
    proposal_id: UUID = Field(foreign_key="api_task_proposals.id", nullable=False, index=True)
    api_module_id: UUID = Field(foreign_key="api_modules.id", nullable=False)
    status: str = Field(default="running")      # running | succeeded | failed
    # request_payload excludes auth headers — stored for audit only
    request_payload: dict | None = Field(
        default=None,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=True),
    )
    response_payload: dict | None = Field(
        default=None,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=True),
    )
    http_status: int | None = Field(default=None)
    error: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = Field(default=None)
