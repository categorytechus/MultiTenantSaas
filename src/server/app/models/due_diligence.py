from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg
from sqlmodel import Column, Field, SQLModel


class DueDiligenceStudy(SQLModel, table=True):
    """
    Top-level container for a due diligence study.

    offering_category : 'real_estate' | 'startup'
    offering_type     : 'multifamily' | 'early_stage'
    status lifecycle  : draft → details_added → documents_uploaded
                        → analyzing → analysis_complete → paid → report_ready
    meta              : all offering-specific fields + extracted metrics + scorecard
                        e.g. {'details': {...}, 'metrics': {...}, 'scorecard': [...], 'report_html': '...'}
    """

    __tablename__ = "due_diligence_studies"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(
        foreign_key="orgs.id", ondelete="CASCADE", nullable=False, index=True
    )
    user_id: Optional[UUID] = Field(
        default=None, foreign_key="users.id", ondelete="SET NULL"
    )
    title: str = Field(nullable=False)
    offering_category: str = Field(nullable=False)   # 'real_estate' | 'startup'
    offering_type: str = Field(nullable=False)        # 'multifamily' | 'early_stage'
    status: str = Field(default="draft", nullable=False)
    meta: Optional[Any] = Field(
        default=None, sa_column=Column(pg.JSONB, nullable=True)
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True)
    )


class DueDiligenceRule(SQLModel, table=True):
    """
    Admin-configurable pass/fail rule for a specific offering type.

    Operators : 'lt' | 'gt' | 'lte' | 'gte' | 'eq'
    Examples  :
      crime_rate    lt   5    %   — Crime Rate must be less than 5%
      occupancy_rate gt  90   %   — Occupancy Rate must be greater than 90%
      runway_months  gt  12  months
    """

    __tablename__ = "due_diligence_rules"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(
        foreign_key="orgs.id", ondelete="CASCADE", nullable=False, index=True
    )
    offering_category: str = Field(nullable=False)   # 'real_estate' | 'startup'
    offering_type: str = Field(nullable=False)        # 'multifamily' | 'early_stage'
    rule_key: str = Field(nullable=False)             # machine key e.g. 'crime_rate'
    rule_label: str = Field(nullable=False)           # human label e.g. 'Crime Rate %'
    operator: str = Field(nullable=False)             # 'lt' | 'gt' | 'lte' | 'gte' | 'eq'
    threshold: float = Field(nullable=False)
    unit: Optional[str] = Field(default=None, nullable=True)  # '%', 'months', 'x', '$', etc.
    enabled: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True)
    )
