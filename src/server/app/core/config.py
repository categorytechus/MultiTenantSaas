from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolves to the project root regardless of the working directory the server is
# launched from (src/server/ via Makefile).
_ENV_FILE = Path(__file__).parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
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
    AWS_SESSION_TOKEN: str = ""

    BEDROCK_MODEL_ARN: str = ""
    BEDROCK_MODEL_PROVIDER: str = "anthropic"
    AWS_BEDROCK_REGION: str = "us-east-1"
    OPENAI_API_KEY: str = ""

    ENVIRONMENT: str = "development"
    # Comma-separated string so pydantic-settings doesn't attempt JSON parsing.
    # Parsed into a list by cors_origins_list below.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # Used for local dev when S3 is not configured
    LOCAL_UPLOAD_DIR: str = "/tmp/uploads"

    # Service name for logging (backend or agents)
    SERVICE_NAME: str = "backend"


settings = Settings()
