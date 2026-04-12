import asyncio
import logging
from concurrent import futures
import grpc
from fastapi import FastAPI
import uvicorn
from contextlib import asynccontextmanager

from proto import rag_pb2, rag_pb2_grpc
from rag_service import RagServiceServicer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- gRPC Server Setup ---
async def serve_grpc():
    server = grpc.aio.server()
    rag_pb2_grpc.add_RagServiceServicer_to_server(RagServiceServicer(), server)
    listen_addr = '[::]:50051'
    server.add_insecure_port(listen_addr)
    logger.info(f"Starting gRPC server on {listen_addr}")
    await server.start()
    await server.wait_for_termination()

# --- FastAPI Server Setup ---

async def serve_grpc_safely():
    try:
        await serve_grpc()
    except Exception as e:
        logger.error(f"FATAL: gRPC Server crashed! {str(e)}", exc_info=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the gRPC server as a background asyncio task when FastAPI starts
    grpc_task = asyncio.create_task(serve_grpc_safely())
    yield
    # Cleanup on shutdown
    grpc_task.cancel()
    try:
        await grpc_task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan, title="RAG Microservice API")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "rag"}

if __name__ == "__main__":
    # Run the Uvicorn web server on port 8000
    logger.info("Starting REST server on port 8000")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
