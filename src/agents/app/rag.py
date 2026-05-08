"""pgvector retrieval for RAG — RLS must already be set on the connection."""
import psycopg


async def retrieve_chunks(
    conn: psycopg.AsyncConnection,
    query_vector: list[float],
    top_k: int = 5,
) -> list[dict]:
    """Return the top-k most similar document chunks for the given query vector.

    Relies on the caller having already set app.current_org_id on the connection
    so that the RLS policy on document_chunks filters to the correct tenant.
    """
    cur = await conn.execute(
        """
        SELECT dc.content,
               d.filename,
               1 - (dc.embedding <=> %s::vector) AS score
        FROM   document_chunks dc
        JOIN   documents d ON d.id = dc.document_id
        WHERE  d.status = 'ready'
        ORDER  BY dc.embedding <=> %s::vector
        LIMIT  %s
        """,
        [query_vector, query_vector, top_k],
    )
    return [
        {"content": row[0], "filename": row[1], "score": float(row[2])}
        for row in await cur.fetchall()
    ]
