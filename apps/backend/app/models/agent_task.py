from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class AgentTaskType(str, Enum):
    TEXT_TO_SQL = "text_to_sql"


class AgentTaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class AgentTask(SQLModel, table=True):
    __tablename__ = "agent_tasks"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    user_id: UUID = Field(foreign_key="users.id", nullable=False)
    type: str = Field(nullable=False)
    status: str = Field(default=AgentTaskStatus.PENDING.value)
    input: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(sa.JSON, nullable=True),
    )
    output: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(sa.JSON, nullable=True),
    )
    error: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = Field(default=None)
