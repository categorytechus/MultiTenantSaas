from typing import TypedDict, List
import os
import json
import grpc
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# Import generated gRPC stubs
from proto import rag_pb2, rag_pb2_grpc
from common.database import fetch_allowed_asset_ids, update_task_status, get_db_cursor

class AgentState(TypedDict, total=False):
    task_id: str
    org_id: str
    user_id: str
    session_id: str
    prompt: str
    action: str
    resources: List[dict]
    agent_type: str  # Now can be "worker_agentX" OR "chat"
    allowed_asset_ids: List[str]
    result: dict

from common.rabbitmq import RabbitMQClient
mq_client = RabbitMQClient()

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# Removed local get_allowed_asset_ids in favor of common.database.fetch_allowed_asset_ids

def decide_agent_type(state: AgentState):
    """
    Decides between an Agent Action (specialized worker) and a Direct Chat (RAG).
    """
    action = state.get('action', '')
    if action:
        return {"agent_type": "worker_agent1"}

    # Use LLM to decide if it's an action or a general query
    prompt = ChatPromptTemplate.from_template("""
    You are an orchestrator routing agent. Classify the user prompt into one of the following:
    - worker_agent1: For any specific tasks, support requests, or specialist actions.
    - chat: A general question that can be answered by searching the knowledge base documents.

    User Prompt: {input}

    Respond ONLY with the identifier (e.g., worker_agent1 or chat).
    """)
    
    chain = prompt | llm | StrOutputParser()
    agent_type = chain.invoke({"input": state['prompt']}).strip()
    
    if agent_type not in ["worker_agent1", "chat"]:
        agent_type = "chat"

    print(f" -> Orchestrator classified task as: {agent_type}")
    
    # Enrich state with RBAC context early
    allowed_ids = fetch_allowed_asset_ids(state['user_id'])
    
    return {"agent_type": agent_type, "allowed_asset_ids": allowed_ids}

def generate_chat_response(state: AgentState):
    """
    Calls the gRPC Chat Knowledge Service to get a full generative answer.
    """
    print(f" -> Calling Chat Knowledge Service for query: {state['prompt']}")
    
    # The Chat Service is our "Knowledge Expert" (Python)
    CHAT_SERVICE_ADDR = os.getenv('CHAT_SERVICE_ADDR', 'chat-service:50052')
    
    # 1. Use Allowed Assets from state
    allowed_ids = state.get('allowed_asset_ids', [])
    
    # 2. Call Chat Expert over gRPC
    try:
        channel = grpc.insecure_channel(CHAT_SERVICE_ADDR)
        stub = rag_pb2_grpc.ChatServiceStub(channel)
        
        response = stub.GenerateAnswer(rag_pb2.ChatRequest(
            query=state['prompt'],
            user_id=state['user_id'],
            allowed_asset_ids=allowed_ids,
            context=[] # Could pass history here
        ))
        
        return {"result": {"answer": response.answer, "sources": "knowledge_base"}}
    except Exception as e:
        print(f" [!] Chat Service gRPC call failed: {e}")
        return {"result": {"error": str(e), "answer": "The knowledge base is currently unavailable."}}

def route_to_worker(state: AgentState):
    """
    Routes the task to a specialized worker via RabbitMQ RPC.
    """
    agent_type = state['agent_type']
    routing_key = f"agents.{agent_type}"
    print(f" -> Delegating to {agent_type}")
    
    try:
        mq_client.publish(routing_key, state)
        print(f" [x] Dispatched task {state['task_id']} to {routing_key}")
        # Return a placeholder result; worker handles finalization
        return {"result": {"status": "dispatched", "message": "Task handed off to worker"}}
    except Exception as e:
        return {"result": {"error": str(e), "answer": "The specialist agent is currently unavailable."}}

def finalize_task(state: AgentState):
    """
    Updates the task status and results in Postgres.
    """
    print(f" [Finalizing Task] {state['task_id']} with result: {state.get('result')}")
    
    # 1. Update Database using common utility
    update_task_status(state['task_id'], 'completed', state.get('result'))
    
    # 2. Add to agent_results for history/analytics
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO agent_results (task_id, organization_id, result_data) VALUES (%s, %s, %s)",
            (state['task_id'], state['org_id'], json.dumps(state['result']))
        )
    
    # 3. Emit event for WebSockets
    routing_key = f"events.{state['org_id']}"
    mq_client.publish(routing_key, {
        "task_id": state['task_id'],
        "session_id": state.get('session_id'),
        "status": "completed",
        "org_id": state['org_id'],
        "data": state['result']
    })
    return state

def run_orchestrator_graph_with_state(initial_state: AgentState, config: dict = None):
    workflow = StateGraph(AgentState)

    workflow.add_node("decide_route", decide_agent_type)
    workflow.add_node("route_worker", route_to_worker)
    workflow.add_node("chat_response", generate_chat_response)
    workflow.add_node("finalize", finalize_task)

    workflow.set_entry_point("decide_route")
    
    # Conditional Edges based on agent_type
    workflow.add_conditional_edges(
        "decide_route",
        lambda x: "chat" if x["agent_type"] == "chat" else "worker",
        {
            "chat": "chat_response",
            "worker": "route_worker"
        }
    )
    
    workflow.add_edge("chat_response", "finalize")
    workflow.add_edge("route_worker", END)
    workflow.add_edge("finalize", END)

    app = workflow.compile()
    return app.invoke(initial_state, config=config)

def run_orchestrator_graph(task_id, org_id, user_id, prompt, resources, session_id=None):
    initial_state = {
        "task_id": task_id,
        "org_id": org_id,
        "user_id": user_id,
        "prompt": prompt,
        "session_id": session_id,
        "action": "",
        "resources": resources,
        "agent_type": "",
        "result": {}
    }
    return run_orchestrator_graph_with_state(initial_state)
