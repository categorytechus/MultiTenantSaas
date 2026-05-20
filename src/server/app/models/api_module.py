from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class ApiModule(SQLModel, table=True):
    __tablename__ = "api_modules"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False, index=True)
    name: str = Field(nullable=False)
    description: str = Field(nullable=False)
    base_url: str = Field(nullable=False)
    method: str = Field(nullable=False)         # GET | POST | PUT | PATCH | DELETE
    endpoint_path: str = Field(nullable=False)
    auth_type: str = Field(default="none")      # none | bearer | basic | api_key
    # auth_config stored as JSONB — never serialised to frontend or LLM
    auth_config: dict | None = Field(
        default=None,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=True),
    )
    # static extra headers sent with every request
    headers: dict | None = Field(
        default=None,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=True),
    )
    # {"field_name": "string|integer|boolean|number", ...}
    request_schema: dict = Field(
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False),
    )
    response_schema: dict | None = Field(
        default=None,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=True),
    )
    enabled: bool = Field(default=True)
    ask_permission: bool = Field(default=True, nullable=False)
    deleted: bool = Field(default=False, nullable=False)
    created_by: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
