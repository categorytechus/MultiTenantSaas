from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/multitenant"
    REDIS_URL: str = "redis://localhost:6379"
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""

    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    ENVIRONMENT: str = "development"
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Used for local dev when S3 is not configured
    LOCAL_UPLOAD_DIR: str = "/tmp/uploads"

    # Service name for logging (backend or agents)
    SERVICE_NAME: str = "backend"

    # Comma-separated user UUIDs that receive super-admin JWT claims and /api/admin/** access.
    SUPER_ADMIN_USER_IDS: str = ""

    # Email invite links (Next.js URL the browser uses).
    PUBLIC_APP_URL: str = "http://localhost:3000"

    # Signup links from POST /api/admin/org-admins/invites expire after this many days.
    INVITE_TOKEN_EXPIRE_DAYS: int = 7


settings = Settings()

# Support comma-separated CORS_ORIGINS from environment files.
if isinstance(settings.CORS_ORIGINS, str):
    settings.CORS_ORIGINS = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
