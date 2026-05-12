# Multi-stage Dockerfile for Multi-Tenant AI SaaS Backend
# Serves both the FastAPI server and the Arq worker (same image, different CMD)

# ─── Stage 1: Build dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

# Install uv
RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy dependency files
COPY pyproject.toml ./

# Install all dependencies from pyproject.toml — single source of truth
RUN uv venv /opt/venv && \
    uv pip install --python /opt/venv/bin/python -r pyproject.toml

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
