# Multi-stage Dockerfile for Multi-Tenant AI SaaS Backend
# Serves both the FastAPI server and the Arq worker (same image, different CMD)

# ─── Stage 1: Build dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

# Install uv
RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy dependency files
COPY pyproject.toml ./

# Install dependencies into a virtual environment
RUN uv venv /opt/venv && \
    uv pip install --python /opt/venv/bin/python -e "." --no-editable 2>/dev/null || \
    uv pip install --python /opt/venv/bin/python \
        "fastapi>=0.115" \
        "uvicorn[standard]>=0.30" \
        "sqlmodel>=0.0.21" \
        "alembic>=1.13" \
        "psycopg[binary]>=3.2" \
        "pgvector>=0.3" \
        "pydantic-settings>=2.5" \
        "python-jose[cryptography]>=3.3" \
        "bcrypt>=4.0" \
        "httpx>=0.27" \
        "aiofiles>=24.1" \
        "arq>=0.26" \
        "redis[hiredis]>=5.0" \
        "structlog>=24.4" \
        "anthropic>=0.40" \
        "openai>=1.50" \
        "boto3>=1.35" \
        "langgraph>=0.2" \
        "langchain-anthropic>=0.3" \
        "sqlglot>=25.0" \
        "pypdf>=5.0" \
        "python-docx>=1.1" \
        "python-multipart>=0.0.12" \
        "authlib>=1.3"

# ─── Stage 2: Runtime image ─────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Install system dependencies required for psycopg and other native extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Set PATH to use venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Copy application code
COPY . .

# Create upload dir for local dev
RUN mkdir -p /tmp/uploads

# Non-root user for security
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app /tmp/uploads
USER appuser

# Expose port for FastAPI
EXPOSE 8000

# Default: run the FastAPI server
# To run the Arq worker instead: docker run ... arq app.jobs.WorkerSettings
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Alternative CMD for worker:
# CMD ["arq", "app.jobs.WorkerSettings"]
