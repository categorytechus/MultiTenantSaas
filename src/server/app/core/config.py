from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolves to the project root .env when running locally (src/server/app/core/ = 4 levels deep).
# In Docker, /app/app/core/ only has 3 parent levels, so we skip the file and rely on env vars.
_parents = Path(__file__).parents
_ENV_FILE = (_parents[4] / ".env") if len(_parents) > 4 else None


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

    # Routes chat and document metadata generation: 'anthropic' uses ANTHROPIC_API_KEY,
    # 'gemini' uses GEMINI_API_KEY, 'bedrock' uses AWS Bedrock (requires temp STS creds).
    CHAT_MODEL: str = "anthropic"  # 'anthropic' | 'gemini' | 'bedrock'
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Anthropic direct API — used exclusively for Claude Skills (report generation).
    # Skills API is NOT available through Bedrock; requires a direct Anthropic key.
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_BASE_URL: str | None = None
    ANTHROPIC_WORKSPACE_ID: str | None = None
    CLAUDE_SKILLS_COST_SEG_ID: str = ""       # Set after creating skill in Console
    CLAUDE_SKILLS_COST_SEG_VERSION: str = "latest"
    CLAUDE_SKILLS_MODEL: str = "claude-sonnet-4-20250514"

    ENVIRONMENT: str = "development"
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    # Comma-separated string so pydantic-settings doesn't attempt JSON parsing.
    # Parsed into a list by cors_origins_list below.
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

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

    # Google OAuth. GOOGLE_REDIRECT_URI is optional; when empty, the backend
    # uses {PUBLIC_APP_URL}/api/auth/google/callback so the Next.js proxy can
    # forward the callback to FastAPI in local and same-origin deployments.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""

    # Microsoft OAuth / Entra ID. MICROSOFT_TENANT can be "common",
    # "organizations", "consumers", or a tenant ID.
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""
    MICROSOFT_REDIRECT_URI: str = ""
    MICROSOFT_TENANT: str = "common"

    # Stripe
    STRIPE_API_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_COST_SEG_PRODUCT_ID: str = ""
    STRIPE_COST_SEG_PRICE_MAPPING: dict[str, str] = {}

    # Email
    ENABLE_EMAILS: bool = False
    EMAIL_FROM: str = "noreply@yourdomain.com"
    
    # Private Deployment Licensing
    CLIENT_JWT_LICENSE_TOKEN: str | None = None
    LICENSE_PUBLIC_KEY: str | None = None


settings = Settings()
