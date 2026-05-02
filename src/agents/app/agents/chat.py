"""Simple LangChain chat agent (dummy — no tools, no RAG yet)."""
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

SYSTEM_PROMPT = "You are a helpful AI assistant."


def build_llm(api_key: str, callbacks: list) -> ChatAnthropic:
    return ChatAnthropic(
        model="claude-haiku-4-5-20251001",
        api_key=api_key,
        streaming=True,
        callbacks=callbacks,
    )


async def run_agent(
    llm: ChatAnthropic,
    history: list[dict],
    user_message: str,
) -> str:
    messages = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in history[-10:]:
        if m["role"] == "user":
            messages.append(HumanMessage(content=m["content"]))
        else:
            messages.append(AIMessage(content=m["content"]))
    messages.append(HumanMessage(content=user_message))

    response = await llm.ainvoke(messages)
    return response.content if isinstance(response.content, str) else str(response.content)
