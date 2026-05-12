from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolves to the project root .env when running locally (src/agents/app/ = 3 levels deep).
# In Docker, /app/app/ only has 2 parent levels, so we skip the file and rely on env vars.
_parents = Path(__file__).parents
_ENV_FILE = (_parents[3] / ".env") if len(_parents) > 3 else None


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
    CHAT_MODEL: str = "gemini"  # "gemini" or "bedrock"
    GEMINI_API_KEY: str = ""
    BEDROCK_MODEL_ARN: str = ""
    BEDROCK_MODEL_PROVIDER: str = "anthropic"
    AWS_BEDROCK_REGION: str = "us-east-1"
    OPENAI_API_KEY: str = ""
    ENVIRONMENT: str = "development"

    # S3 / local file storage (mirrors server config)
    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_SESSION_TOKEN: str = ""
    LOCAL_UPLOAD_DIR: str = "/tmp/uploads"


settings = Settings()
