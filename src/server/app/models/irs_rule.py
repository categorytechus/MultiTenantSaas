from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlmodel import Column, Field, SQLModel


class IrsRuleStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class IrsRule(SQLModel, table=True):
    __tablename__ = "irs_rules"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    filename: str = Field(nullable=False)
    title: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    s3_key: str | None = Field(default=None, nullable=True)
    size_bytes: int | None = Field(default=None)
    status: str = Field(default=IrsRuleStatus.PROCESSING.value)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime | None = Field(default=None, sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True))


class IrsRuleChunk(SQLModel, table=True):
    __tablename__ = "irs_rule_chunks"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    irs_rule_id: UUID = Field(foreign_key="irs_rules.id", nullable=False)
    chunk_index: int = Field(nullable=False)
    content: str = Field(sa_column=Column(sa.Text, nullable=False))
    embedding: Optional[list[float]] = Field(
        default=None,
        sa_column=Column(Vector(384), nullable=True),
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
