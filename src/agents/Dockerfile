FROM python:3.12-slim AS builder

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml ./

RUN uv venv /opt/venv && \
    uv pip install --python /opt/venv/bin/python \
        "arq>=0.26" \
        "httpx>=0.27" \
        "langchain>=0.3" \
        "langchain-anthropic>=0.3" \
        "langchain-core>=0.3" \
        "psycopg[async]>=3.2" \
        "pgvector>=0.3" \
        "redis[hiredis]>=5.0" \
        "pydantic-settings>=2.5" \
        "structlog>=24.4" \
        "openai>=1.50" \
        "boto3>=1.35" \
        "aiofiles>=24.1" \
        "pypdf>=5.0" \
        "python-docx>=1.1"

FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY . .

RUN useradd --create-home --shell /bin/bash appuser && chown -R appuser:appuser /app
USER appuser

CMD ["arq", "app.jobs.WorkerSettings"]
