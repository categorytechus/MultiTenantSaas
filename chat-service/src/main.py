import os
import grpc
import logging
from concurrent import futures
import asyncio
from fastapi import FastAPI
import uvicorn
from threading import Thread

# Import generated stubs
from proto import rag_pb2, rag_pb2_grpc

# LangChain imports
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ChatServiceServicer(rag_pb2_grpc.ChatServiceServicer):
    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4o", temperature=0)
        self.rag_service_addr = os.getenv('RAG_SERVICE_ADDR', 'rag-service:50051')

    async def GenerateAnswer(self, request, context):
        logger.info(f"[ChatService] Generating answer for user {request.user_id}: {request.query}")
        
        try:
            # 1. Fetch relevant document chunks from RagService (gRPC)
            async with grpc.aio.insecure_channel(self.rag_service_addr) as channel:
                stub = rag_pb2_grpc.RagServiceStub(channel)
                rag_response = await stub.RetrieveDocuments(rag_pb2.RetrievalRequest(
                    query=request.query,
                    user_id=request.user_id,
                    allowed_asset_ids=request.allowed_asset_ids,
                    context=request.context
                ))
            
            chunks = rag_response.chunks
            context_text = "\n\n".join([c.page_content for c in chunks])
            logger.info(f"[ChatService] Retrieved {len(chunks)} chunks from RAG service")

            # 2. Build QA Chain
            qa_prompt = ChatPromptTemplate.from_template("""
            You are a helpful multi-tenant SaaS assistant. Answer the user's question using ONLY the provided context.
            If the context is insufficient, state that you don't know based on the shared documents.

            Context:
            {context}

            Question: {input}
            """)
            
            chain = qa_prompt | self.llm | StrOutputParser()
            
            # 3. Generate Answer
            # Note: chain.invoke is usually synchronous, but ChatOpenAI uses a_invoke for async
            answer = await chain.ainvoke({"context": context_text, "input": request.query})

            # 4. Return result
            return rag_pb2.ChatResponse(
                answer=answer,
                chunks=chunks
            )

        except Exception as e:
            logger.error(f"[ChatService] Error occurred: {str(e)}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return rag_pb2.ChatResponse()

from grpc_health.v1 import health, health_pb2, health_pb2_grpc

# --- Global Health Servicer ---
health_servicer = health.HealthServicer()

# --- Dual Server Management (gRPC + FastAPI) ---

app = FastAPI()

@app.get("/health")
async def health_check():
    # Check gRPC health status
    status = health_servicer.get("ChatService")
    if status == health_pb2.HealthCheckResponse.SERVING:
        return {"status": "ok", "service": "chat-knowledge-python", "grpc": "serving"}
    else:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="gRPC service is not serving")

async def serve_grpc():
    server = grpc.aio.server()
    rag_pb2_grpc.add_ChatServiceServicer_to_server(ChatServiceServicer(), server)
    
    # Register the health servicer
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    health_servicer.set("ChatService", health_pb2.HealthCheckResponse.SERVING)
    
    listen_addr = '[::]:50052'
    server.add_insecure_port(listen_addr)
    logger.info(f"Chat Service (gRPC) starting on {listen_addr}")
    await server.start()
    await server.wait_for_termination()


def run_grpc_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(serve_grpc())

if __name__ == "__main__":
    # Run FastAPI in a background thread or use uvicorn in a way that allows gRPC
    # Standard pattern: Run gRPC as the main event loop, and FastAPI via uvicorn in a thread (or vice versa)
    
    # Start gRPC in a separate thread
    grpc_thread = Thread(target=run_grpc_loop, daemon=True)
    grpc_thread.start()

    # Start FastAPI
    logger.info("Chat Service (REST) Starting on port 3002")
    uvicorn.run(app, host="0.0.0.0", port=3002)
