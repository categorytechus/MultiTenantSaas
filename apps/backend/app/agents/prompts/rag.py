from typing import Any


def build_rag_prompt(
    history: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
    user_message: str,
) -> list[dict[str, Any]]:
    """
    Build the message list for Anthropic Claude RAG chat.

    Args:
        history: List of previous messages [{role, content}, ...]
        chunks: Retrieved document chunks [{content, score, document_id, id}, ...]
        user_message: The current user message

    Returns:
        List of message dicts for the Anthropic API
    """
    # Build context from retrieved chunks
    if chunks:
        context_parts = []
        for i, chunk in enumerate(chunks, 1):
            content = chunk.get("content", "")
            doc_id = chunk.get("document_id", "unknown")
            score = chunk.get("score", 0.0)
            context_parts.append(
                f"[Source {i} | Document: {doc_id} | Relevance: {score:.3f}]\n{content}"
            )
        context_text = "\n\n---\n\n".join(context_parts)
    else:
        context_text = "No relevant documents found."

    system_message = f"""You are a helpful AI assistant with access to a knowledge base.
Use the provided context to answer questions accurately. If the context doesn't contain
the information needed, say so clearly. Always cite which sources you used.

CONTEXT FROM KNOWLEDGE BASE:
{context_text}

INSTRUCTIONS:
- Answer based on the provided context when possible
- If the context is insufficient, acknowledge the limitation
- Be concise and accurate
- Reference source numbers (e.g., [Source 1]) when citing information"""

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_message}]

    # Add conversation history (excluding the current user message)
    for msg in history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    # Add the current user message
    messages.append({"role": "user", "content": user_message})

    return messages
