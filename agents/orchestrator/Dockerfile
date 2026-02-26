# Python Dockerfile for Agent Orchestrator
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared code
COPY common ./common

# Copy source code
COPY orchestrator/ .

# Environment variables
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
