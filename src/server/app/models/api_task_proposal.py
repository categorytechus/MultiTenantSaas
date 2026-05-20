from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


# Allowed lifecycle statuses for a proposal
PROPOSAL_STATUSES = (
    "pending_confirmation",
    "accepted",
    "declined",
    "expired",
    "executing",
    "succeeded",
    "failed",
)


class ApiTaskProposal(SQLModel, table=True):
    __tablename__ = "api_task_proposals"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False, index=True)
    chat_session_id: UUID = Field(foreign_key="chat_sessions.id", nullable=False, index=True)
    agent_task_id: UUID | None = Field(default=None, foreign_key="agent_tasks.id")
    api_module_id: UUID = Field(foreign_key="api_modules.id", nullable=False)
    title: str = Field(nullable=False)
    description: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    # The payload the LLM proposes to send; validated before execution
    input_payload: dict = Field(
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False),
    )
    status: str = Field(default="pending_confirmation")
    proposed_by: UUID | None = Field(default=None, foreign_key="users.id")
    accepted_by: UUID | None = Field(default=None, foreign_key="users.id")
    declined_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    decided_at: datetime | None = Field(default=None)
