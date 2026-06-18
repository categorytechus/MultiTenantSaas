from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class CostSegRuleset(SQLModel, table=True):
    __tablename__ = "cost_seg_rulesets"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID | None = Field(default=None, foreign_key="orgs.id", ondelete="CASCADE", index=True)
    workflow_type: str = Field(default="cost_seg", nullable=False)  # e.g. "cost_seg"
    filename: str = Field(nullable=False)
    s3_key: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    size_bytes: int | None = Field(default=None)
    status: str = Field(default="ready")  # "ready" | "failed"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True),
    )
