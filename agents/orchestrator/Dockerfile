FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY agents/orchestrator/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared code
COPY agents/common ./common

# Copy source code (includes proto/ subdirectory)
COPY agents/orchestrator/ .

# Generate gRPC stubs
RUN python -m grpc_tools.protoc -I./proto --python_out=./proto --grpc_python_out=./proto ./proto/rag.proto

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

CMD ["python", "main.py"]

