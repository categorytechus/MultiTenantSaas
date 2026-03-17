import os
import json
import boto3
import logging
from typing import List

from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain_core.documents import Document
from sentence_transformers import CrossEncoder
from langchain_community.document_compressors import CrossEncoderReranker
from langchain_classic.retrievers import ContextualCompressionRetriever

from proto import rag_pb2, rag_pb2_grpc
from utils.letta_client import LettaClient

logger = logging.getLogger(__name__)

class RagServiceServicer(rag_pb2_grpc.RagServiceServicer):
    def __init__(self):
        super().__init__()
        # Load cross-encoder once on CPU at startup
        logger.info("Loading cross-encoder/ms-marco-MiniLM-L-6-v2 on CPU...")
        self.cross_encoder = CrossEncoder(
            "cross-encoder/ms-marco-MiniLM-L-6-v2",
            device="cpu"
        )
        self.compressor = CrossEncoderReranker(model=self.cross_encoder, top_n=5)
        self.s3_client = boto3.client('s3')
        self.embeddings = OpenAIEmbeddings()
        self.letta = LettaClient()

    async def _get_retriever(self, allowed_asset_ids: List[str]):
        bucket_name = os.getenv('S3_VECTOR_BUCKET')
        all_documents = []

        for asset_id in allowed_asset_ids:
            key = f"embeddings/{asset_id}.json"
            try:
                response = self.s3_client.get_object(Bucket=bucket_name, Key=key)
                data = json.loads(response['Body'].read().decode('utf-8'))
                
                # Parsing documents from serialized JSON
                for doc_data in data:
                    all_documents.append(Document(
                        page_content=doc_data.get('pageContent', ''),
                        metadata=doc_data.get('metadata', {})
                    ))
            except Exception as e:
                logger.error(f"Error fetching asset {asset_id} from S3: {e}")

        if not all_documents:
            return None

        # Create temporary in-memory FAISS index
        vector_store = FAISS.from_documents(all_documents, self.embeddings)
        base_retriever = vector_store.as_retriever(search_kwargs={"k": 20})

        # Wrap with ContextualCompressionRetriever for reranking
        return ContextualCompressionRetriever(
            base_compressor=self.compressor,
            base_retriever=base_retriever
        )

    async def RetrieveDocuments(self, request: rag_pb2.RetrievalRequest, context):
        logger.info(f"Retrieving documents for user {request.user_id} with query: {request.query}")
        
        try:
            # 1. Fetch Previous Context (Letta) if not provided by caller
            msgs = list(request.context)
            if not msgs:
                logger.info("No context provided, fetching from Letta...")
                letta_context = await self.letta.get_recent_context(request.user_id)
                for m in letta_context:
                    msgs.append(rag_pb2.Message(role=m['role'], content=m['content']))

            # 2. Perform RAG retrieval
            retriever = await self._get_retriever(request.allowed_asset_ids)
            if not retriever:
                return rag_pb2.RetrievalResponse(chunks=[])

            # RAG flow: Dense Retrieval (K=20) -> Cross-Encoder Rerank (N=5)
            # Use contextualized query if history is long, but for now we use request.query
            reranked_docs = retriever.invoke(request.query)

            response = rag_pb2.RetrievalResponse()
            for doc in reranked_docs:
                response.chunks.append(rag_pb2.Document(
                    page_content=doc.page_content,
                    metadata={k: str(v) for k, v in doc.metadata.items()},
                    score=float(doc.metadata.get('relevance_score', 0.0))
                ))
            
            return response

        except Exception as e:
            logger.error(f"Failed to process RAG request: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return rag_pb2.RetrievalResponse()
