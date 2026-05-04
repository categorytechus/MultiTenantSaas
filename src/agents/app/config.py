from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolves to the project root regardless of the working directory the worker is
# launched from (src/agents/ via Makefile).
_ENV_FILE = Path(__file__).parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/multitenant"
    SERVER_URL: str = "http://localhost:8000"
    SECRET_KEY: str = "change-me-in-production"
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ENVIRONMENT: str = "development"

    # S3 / local file storage (mirrors server config)
    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    LOCAL_UPLOAD_DIR: str = "/tmp/uploads"


settings = Settings()
