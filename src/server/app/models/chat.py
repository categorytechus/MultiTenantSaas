from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class ChatSession(SQLModel, table=True):
    __tablename__ = "chat_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    user_id: UUID = Field(foreign_key="users.id", nullable=False)
    title: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    chat_id: UUID = Field(foreign_key="chat_sessions.id", nullable=False)
    role: str = Field(nullable=False)  # "user" | "assistant"
    content: str = Field(sa_column=Column(sa.Text, nullable=False))
    sources: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(sa.JSON, nullable=True),
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
