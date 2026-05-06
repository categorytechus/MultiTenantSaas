from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class MasterModule(SQLModel, table=True):
    __tablename__ = "master_modules"

    id: str = Field(primary_key=True, max_length=50)
    name: str = Field(nullable=False, max_length=120)
    enabled: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

