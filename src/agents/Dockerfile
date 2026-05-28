FROM python:3.12-slim AS builder

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml ./

# Install all dependencies from pyproject.toml — single source of truth
RUN uv venv /opt/venv && \
    uv pip install --python /opt/venv/bin/python -r pyproject.toml

FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY . .

# Pre-download the fastembed embedding model at build time so the first chat
# request doesn't hang while the worker downloads ~130 MB from HuggingFace.
ENV FASTEMBED_CACHE_PATH=/opt/fastembed-cache
RUN mkdir -p /opt/fastembed-cache && \
    python3 -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app /opt/fastembed-cache
USER appuser

CMD ["arq", "app.jobs.WorkerSettings"]
