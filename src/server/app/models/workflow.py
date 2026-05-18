from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg
from sqlmodel import Column, Field, SQLModel


class WorkflowSession(SQLModel, table=True):
    """
    Generic container for any multi-step workflow or session.

    type examples : 'cost_seg', 'contract_review', 'due_diligence', ...
    status        : flow-specific string — each type defines its own lifecycle
    step          : current wizard step (null for non-wizard flows like chat)
    meta          : all flow-specific configuration / property data as JSONB
                    e.g. for cost_seg: {"property": {address, total_cost, ...}}
    """
    __tablename__ = "workflow_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False)
    type: str = Field(nullable=False, index=True)
    title: str = Field(nullable=False)
    status: str = Field(default="draft", nullable=False)
    step: Optional[int] = Field(default=None, nullable=True)
    meta: Optional[Any] = Field(
        default=None, sa_column=Column(pg.JSONB, nullable=True)
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True)
    )


class WorkflowItem(SQLModel, table=True):
    """
    Generic row within a workflow session.

    type examples  : 'line_item' (cost_seg), 'message' (chat), 'finding' (review)
    role           : 'ai'|'manual' for cost_seg; 'user'|'assistant' for chat
    content        : primary text (description, message body, etc.)
    amount         : dollar value for financial items; null for text-only items
    data           : all extended fields as JSONB, e.g.:
                     cost_seg  → {category_id, recovery_period, bonus_eligible,
                                   year1_deduction, confidence, ai_notes,
                                   user_edited, source_doc_id}
                     chat msg  → {sources: [...]}
    sort_order     : explicit ordering within the session
    """
    __tablename__ = "workflow_items"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    session_id: UUID = Field(foreign_key="workflow_sessions.id", nullable=False, index=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    type: str = Field(nullable=False, index=True)
    role: Optional[str] = Field(default=None, nullable=True)
    content: Optional[str] = Field(
        default=None, sa_column=Column(sa.Text, nullable=True)
    )
    amount: Optional[float] = Field(default=None, nullable=True)
    data: Optional[Any] = Field(
        default=None, sa_column=Column(pg.JSONB, nullable=True)
    )
    sort_order: int = Field(default=0, nullable=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkflowOutput(SQLModel, table=True):
    """
    Final generated artifact for a workflow session.

    type examples  : 'html_report', 'pdf', 'summary', 'export'
    content        : raw text/HTML body
    data           : structured metadata as JSONB (totals, page_count, etc.)
    One row per (session_id, type) — upserted on regeneration.
    """
    __tablename__ = "workflow_outputs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    session_id: UUID = Field(foreign_key="workflow_sessions.id", nullable=False, index=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    type: str = Field(nullable=False)
    content: Optional[str] = Field(
        default=None, sa_column=Column(sa.Text, nullable=True)
    )
    data: Optional[Any] = Field(
        default=None, sa_column=Column(pg.JSONB, nullable=True)
    )
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
