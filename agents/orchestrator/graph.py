from typing import TypedDict, List
from langgraph.graph import StateGraph, END

class AgentState(TypedDict, total=False):
    task_id: str
    org_id: str
    user_id: str
    prompt: str
    action: str
    resources: List[dict]
    agent_type: str
    result: dict

from common.rabbitmq import RabbitMQClient
mq_client = RabbitMQClient()

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

llm = ChatOpenAI(model="gpt-4o", temperature=0)

def decide_agent_type(state: AgentState):
    """
    Decides agent type using an LLM.
    """
    # Check for explicit actions first (from REST endpoints)
    action = state.get('action', '')
    if action == 'agents:create':
        return {"agent_type": "worker_agent1"}
    elif action == 'users:manage':
        return {"agent_type": "worker_agent3"}
    elif action == 'organizations:update':
        return {"agent_type": "worker_agent2"}

    # Use LLM for classification for chat
    prompt = ChatPromptTemplate.from_template("""
    You are a routing agent. Classified the user prompt into one of the following agent types:
    - worker_agent1: General queries, information, or tasks not covered by others.
    - worker_agent2: Enrollment, payroll, human resources, or benefits.
    - worker_agent3: IT support, help desk, technical issues, or system access.

    User Prompt: {input}

    Respond ONLY with the agent type identifier (e.g., worker_agent1).
    """)
    
    chain = prompt | llm | StrOutputParser()
    agent_type = chain.invoke({"input": state['prompt']}).strip()
    
    # Validation
    if agent_type not in ["worker_agent1", "worker_agent2", "worker_agent3"]:
        agent_type = "worker_agent1"

    print(f" -> LLM classified task as: {agent_type}")
    return {"agent_type": agent_type}

def route_to_worker(state: AgentState):
    """
    Routes the task to a specialized worker via RabbitMQ RPC.
    """
    agent_type = state['agent_type']
    routing_key = f"agents.{agent_type}"
    
    print(f" -> Delegating task {state['task_id']} to {agent_type} via {routing_key}")
    
    try:
        # Call the worker and wait for the response (synchronous for demo)
        worker_result = mq_client.call(routing_key, state)
        return {"result": worker_result}
    except Exception as e:
        print(f" [!] Delegation failed: {e}")
        return {"result": {"error": str(e), "answer": "The specialist agent is currently unavailable."}}

def finalize_task(state: AgentState):
    """
    Update the database with the final result.
    """
    import psycopg2
    import os
    import json
    
    DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://admin:admin@localhost:5432/multitenant_saas')
    
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            # 1. Update task status
            cur.execute(
                "UPDATE agent_tasks SET status = 'completed', completed_at = NOW() WHERE id = %s",
                (state['task_id'],)
            )
            # 2. Insert result
            cur.execute(
                """
                INSERT INTO agent_results (task_id, organization_id, result_data)
                VALUES (%s, %s, %s)
                """,
                (state['task_id'], state['org_id'], json.dumps(state['result']))
            )
            conn.commit()
    
    # Emit completion event for WebSocket streaming
    try:
        from common.rabbitmq import RabbitMQClient
        mq_client = RabbitMQClient()
        routing_key = f"events.{state['org_id']}"
        mq_client.publish(routing_key, {
            "task_id": state['task_id'],
            "org_id": state['org_id'],
            "status": "completed",
            "data": state['result']
        })
    except Exception as e:
        print(f" [!] Failed to emit completion event: {e}")
    
    return state

def run_orchestrator_graph_with_state(initial_state: AgentState):
    workflow = StateGraph(AgentState)

    workflow.add_node("decide_agent", decide_agent_type)
    workflow.add_node("route_worker", route_to_worker)
    workflow.add_node("finalize", finalize_task)

    workflow.set_entry_point("decide_agent")
    workflow.add_edge("decide_agent", "route_worker")
    workflow.add_edge("route_worker", "finalize")
    workflow.add_edge("finalize", END)

    app = workflow.compile()
    return app.invoke(initial_state)

def run_orchestrator_graph(task_id, org_id, user_id, prompt, resources):
    initial_state = {
        "task_id": task_id,
        "org_id": org_id,
        "user_id": user_id,
        "prompt": prompt,
        "action": "",
        "resources": resources,
        "agent_type": "",
        "result": {}
    }
    return run_orchestrator_graph_with_state(initial_state)
