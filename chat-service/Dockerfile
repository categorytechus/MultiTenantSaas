FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY chat-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared code
COPY agents/common ./common

# Copy protobufs source
COPY agents/orchestrator/proto ./proto

# Copy source code
COPY chat-service/src ./src

# Generate gRPC stubs inside src/proto
RUN mkdir -p /app/src/proto && \
    python -m grpc_tools.protoc -I/app/proto --python_out=/app/src/proto --grpc_python_out=/app/src/proto /app/proto/rag.proto && \
    touch /app/src/proto/__init__.py && \
    # Fix relative imports in generated code
    sed -i 's/^import rag_pb2 as rag__pb2/from . import rag_pb2 as rag__pb2/' /app/src/proto/rag_pb2_grpc.py

EXPOSE 50052
EXPOSE 3002

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src:/app

WORKDIR /app/src

CMD ["python", "main.py"]
