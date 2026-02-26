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

def decide_agent_type(state: AgentState):
    """
    Decides agent type based on action or keywords in prompt.
    """
    # Check for explicit actions first (from REST endpoints)
    action = state.get('action', '')
    if action == 'agents:create':
        return {"agent_type": "worker_agent1"}
    elif action == 'users:manage':
        return {"agent_type": "worker_agent3"}
    elif action == 'organizations:update':
        return {"agent_type": "worker_agent2"}

    # Fallback to keyword-based routing for chat
    prompt = state['prompt'].lower()
    if 'payroll' in prompt or 'enroll' in prompt:
        return {"agent_type": "worker_agent2"}
    elif 'support' in prompt or 'help' in prompt or 'it' in prompt:
        return {"agent_type": "worker_agent3"}
    else:
        return {"agent_type": "worker_agent1"}

def route_to_worker(state: AgentState):
    """
    Simulates routing to specialized workers.
    In a real app, this would push back to a specific RabbitMQ queue or invoke a subgraph.
    """
    agent_type = state['agent_type']
    print(f" -> Routing task {state['task_id']} to {agent_type} worker")
    
    # Simulate worker response
    return {
        "result": {
            "answer": f"This is a response from the {agent_type} agent regarding your query: {state['prompt'][:50]}...",
            "sources": [r['name'] for r in state['resources']]
        }
    }

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
        mq_client.publish('event.created', {
            "task_id": state['task_id'],
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
