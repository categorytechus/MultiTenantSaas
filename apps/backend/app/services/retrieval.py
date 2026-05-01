from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def vector_search(
    session: AsyncSession,
    q_emb: list[float],
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    Perform cosine similarity vector search over document_chunks.
    RLS automatically scopes results to the current org.

    Returns a list of dicts with: id, document_id, chunk_index, content, score
    """
    # Convert the embedding list to a PostgreSQL vector literal
    embedding_str = "[" + ",".join(str(v) for v in q_emb) + "]"

    sql = text(
        """
        SELECT
            id,
            document_id,
            chunk_index,
            content,
            1 - (embedding <=> CAST(:embedding AS vector)) AS score
        FROM document_chunks
        ORDER BY embedding <=> CAST(:embedding AS vector)
        LIMIT :limit
        """
    )

    result = await session.execute(
        sql,
        {"embedding": embedding_str, "limit": limit},
    )

    rows = result.fetchall()
    return [
        {
            "id": str(row.id),
            "document_id": str(row.document_id),
            "chunk_index": row.chunk_index,
            "content": row.content,
            "score": float(row.score) if row.score is not None else 0.0,
        }
        for row in rows
    ]
