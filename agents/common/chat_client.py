import os
import grpc
import logging
from typing import List, Optional

# Import generated stubs
from proto import rag_pb2, rag_pb2_grpc

logger = logging.getLogger(__name__)

class ChatServiceClient:
    def __init__(self, addr: Optional[str] = None):
        self.addr = addr or os.getenv('CHAT_SERVICE_ADDR', 'chat-service:50052')

    async def query_knowledge_base(self, query: str, user_id: str, allowed_asset_ids: List[str]) -> dict:
        """
        Calls the Chat Service to perform a RAG-based query against the knowledge base.
        """
        try:
            async with grpc.aio.insecure_channel(self.addr) as channel:
                stub = rag_pb2_grpc.ChatServiceStub(channel)
                response = await stub.GenerateAnswer(rag_pb2.ChatRequest(
                    query=query,
                    user_id=user_id,
                    allowed_asset_ids=allowed_asset_ids,
                    context=[] # Context can be added for multi-turn
                ))
                return {
                    "answer": response.answer,
                    "sources": [c.metadata.get('source', 'unknown') for c in response.chunks]
                }
        except Exception as e:
            logger.error(f"ChatServiceClient error: {e}")
            return {"error": str(e), "answer": "Knowledge base retrieval failed."}
