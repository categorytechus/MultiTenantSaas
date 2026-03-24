FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for build
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY agents/worker_agent1/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared code
COPY agents/common ./common

# Copy protobufs source
COPY agents/orchestrator/proto ./proto

# Copy source code
COPY agents/worker_agent1/ .

# Generate gRPC stubs inside proto
RUN python -m grpc_tools.protoc -I/app/proto --python_out=/app/proto --grpc_python_out=/app/proto /app/proto/rag.proto && \
    touch /app/proto/__init__.py && \
    # Fix relative imports in generated code
    sed -i 's/^import rag_pb2 as rag__pb2/from . import rag_pb2 as rag__pb2/' /app/proto/rag_pb2_grpc.py

# Create non-root user for security
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

CMD ["python", "main.py"]