from datetime import datetime
from langchain_aws import ChatBedrock
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from common.chat_client import ChatServiceClient

# llm = ChatBedrock(model_id="openai.gpt-oss-120b-1:0", model_kwargs={"temperature": 0})
llm = ChatBedrock(
    model_id="openai.gpt-oss-120b-1:0",
    model_kwargs={"temperature": 0},
)
chat_client = ChatServiceClient()

def invoke_agent(action, payload):
    """
    Agentic loop that can query the knowledge base as needed.
    """
    prompt_text = payload.get('prompt', '')
    user_id = payload.get('user_id', '')
    # Orchestrator should pass these
    allowed_asset_ids = payload.get('allowed_asset_ids', [])

    @tool
    async def query_knowledge_base(query: str):
        """
        Consult the knowledge base for specific company policies, documentation, or FAQs.
        Use this when the user asks about something specific that isn't in your general training.
        """
        result = await chat_client.query_knowledge_base(query, user_id, allowed_asset_ids)
        return f"Knowledge Base Response: {result['answer']}\nSources: {', '.join(result.get('sources', []))}"

    tools = [query_knowledge_base]
    agent_executor = create_react_agent(llm, tools)

    # Note: invoke_agent is called synchronously by the RabbitMQ consumer, 
    # but the tool and LLM calls are async. We use asyncio.run for simplicity here,
    # though in a production high-load scenario, the consumer should be async.
    import asyncio
    
    async def run_agent():
        response = await agent_executor.ainvoke({
            "messages": [("user", prompt_text)]
        })
        return response["messages"][-1].content

    answer = asyncio.run(run_agent())
    
    return {
        "status": "success",
        "agent": "WorkerAgent1 (Agentic RAG)",
        "answer": answer,
        "timestamp": datetime.now().isoformat()
    }
