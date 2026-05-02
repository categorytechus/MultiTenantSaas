from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlmodel import Column, Field, SQLModel


class DocumentStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    BLOCKED = "blocked"


class Document(SQLModel, table=True):
    __tablename__ = "documents"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    s3_key: str = Field(nullable=False)
    filename: str = Field(nullable=False)
    mime_type: str | None = Field(default=None)
    size_bytes: int | None = Field(default=None)
    status: str = Field(default=DocumentStatus.PROCESSING.value)
    uploaded_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DocumentChunk(SQLModel, table=True):
    __tablename__ = "document_chunks"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False)
    chunk_index: int = Field(nullable=False)
    content: str = Field(sa_column=Column(sa.Text, nullable=False))
    embedding: Optional[list[float]] = Field(
        default=None,
        sa_column=Column(Vector(1536), nullable=True),
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
