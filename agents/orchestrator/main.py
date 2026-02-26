import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from common.rabbitmq import RabbitMQClient, publish_with_retry

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://admin:admin@localhost:5432/multitenant_saas')
QUEUE_NAME = 'agent.requests'

mq_client = RabbitMQClient()

def get_db_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def update_task_status(task_id, status, error_message=None, data=None):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_tasks SET status = %s, error_message = %s, updated_at = NOW() WHERE id = %s",
                (status, error_message, task_id)
            )
            conn.commit()
    
    # Emit event for WebSocket streaming
    mq_client.publish('event.created', {
        "task_id": task_id,
        "status": status,
        "data": data or {}
    })

def update_task_status(task_id, status, error_message=None, data=None):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_tasks SET status = %s, error_message = %s, updated_at = NOW() WHERE id = %s",
                (status, error_message, task_id)
            )
            conn.commit()
    
    # Emit event for WebSocket streaming
    mq_client.publish('event.created', {
        "task_id": task_id,
        "status": status,
        "data": data or {}
    })

def callback(ch, method, properties, body):
    print(f" [x] Received request: {body}")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        print(" [!] Failed to decode JSON")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return
    
    task_id = data.get('taskId')
    user_id = data.get('userId')
    org_id = data.get('orgId')
    prompt = data.get('prompt')
    action = data.get('action')
    resources = data.get('resources')

    if not task_id:
        print(" [!] Missing taskId in message")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    try:
        # 1. Update Status to Running (Creation already handled by Gateway)
        update_task_status(task_id, 'running')

        # 2. Invoke LangGraph Orchestrator
        initial_state = {
            "task_id": task_id,
            "org_id": org_id,
            "user_id": user_id,
            "prompt": prompt,
            "action": action,
            "resources": resources,
            "agent_type": "",
            "result": {}
        }
        
        from graph import run_orchestrator_graph_with_state
        result = run_orchestrator_graph_with_state(initial_state)

        # 3. Final Status (Done)
        print(f" [x] Orchestration Complete: {result}")
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print(f" [!] Error in Orchestrator: {e}")
        update_task_status(task_id, 'failed', str(e))
        
        # Implement retry logic
        headers = properties.headers or {}
        # Use specific routing key for retry to maintain org affinity
        routing_key = f"agents.request.{org_id}"
        if not publish_with_retry(ch, routing_key, data, headers):
            # Max retries reached
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    # Consume with wildcards for all orgs
    mq_client.consume(QUEUE_NAME, callback, routing_key='agents.request.#')

if __name__ == '__main__':
    main()
