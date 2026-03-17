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

# Copy protobufs
COPY infrastructure/proto ./proto

# Copy source code
COPY chat-service/src /app/src

WORKDIR /app/src

# Generate gRPC stubs
RUN python -m grpc_tools.protoc -I/app/proto --python_out=/app/src/proto --grpc_python_out=/app/src/proto /app/proto/rag.proto

EXPOSE 50052
EXPOSE 3002

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src:/app

CMD ["python", "main.py"]

