from typing import Any

from app.agents.context import AgentContext
from app.integrations.embeddings import embed
from app.services.retrieval import vector_search


async def document_search_tool(
    ctx: AgentContext,
    query: str,
    k: int = 10,
) -> list[dict[str, Any]]:
    """
    Search for relevant document chunks using vector similarity.

    Args:
        ctx: Agent context with session and org context
        query: Natural language search query
        k: Number of results to return (default 10)

    Returns:
        List of matching chunks with content and metadata
    """
    # Embed the query
    q_embedding = await embed(query)

    # Perform vector search (RLS automatically scopes to ctx.org_id)
    chunks = await vector_search(ctx.session, q_embedding, limit=k)

    return chunks
