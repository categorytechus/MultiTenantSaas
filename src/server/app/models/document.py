from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql  # noqa: F401  — needed for JSONB
from pgvector.sqlalchemy import Vector
from sqlmodel import Column, Field, SQLModel
from sqlalchemy import JSON, ForeignKey


class DocumentStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    BLOCKED = "blocked"


class Document(SQLModel, table=True):
    __tablename__ = "documents"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    s3_key: str | None = Field(default=None, nullable=True)
    source_url: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    document_type: str = Field(default="file")  # 'file' | 'url'
    filename: str = Field(nullable=False)
    mime_type: str | None = Field(default=None)
    size_bytes: int | None = Field(default=None)
    status: str = Field(default=DocumentStatus.PROCESSING.value)
    uploaded_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime | None = Field(default=None, sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True))
    extracted_title: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    summary: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    keywords: Optional[Any] = Field(default=None, sa_column=Column(JSON, nullable=True))
    tags: Optional[Any] = Field(default=None, sa_column=Column(sa.dialects.postgresql.JSONB, nullable=True))
    description: str | None = Field(default=None, sa_column=Column(sa.Text, nullable=True))
    # Nullable FK to workflow_sessions — set when a document belongs to a workflow
    # (e.g. cost_seg project uploads). Null for standalone RAG/knowledge-base docs.
    session_id: UUID | None = Field(
        default=None,
        sa_column=Column(sa.UUID(), ForeignKey("workflow_sessions.id"), nullable=True),
    )


class DocumentChunk(SQLModel, table=True):
    __tablename__ = "document_chunks"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False)
    chunk_index: int = Field(nullable=False)
    content: str = Field(sa_column=Column(sa.Text, nullable=False))
    embedding: Optional[list[float]] = Field(
        default=None,
        sa_column=Column(Vector(384), nullable=True),
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
