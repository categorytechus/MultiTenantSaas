import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from common.rabbitmq import RabbitMQClient, publish_with_retry

from common.database import update_task_status as db_update_status
QUEUE_NAME = 'tasks'

mq_client = RabbitMQClient()

def update_task_status(task_id, org_id, status, session_id=None, error_message=None, data=None):
    # 1. Update Database
    db_update_status(task_id, status, data)
    
    # 2. Emit event for WebSocket streaming using events.{org_id} routing key
    routing_key = f"events.{org_id}"
    mq_client.publish(routing_key, {
        "task_id": task_id,
        "session_id": session_id,
        "org_id": org_id,
        "status": status,
        "data": data or {},
        "error": error_message
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
    session_id = data.get('sessionId')
    prompt = data.get('prompt')
    action = data.get('action')
    resources = data.get('resources')

    if not task_id:
        print(" [!] Missing taskId in message")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    try:
        # 1. Update Status to Running (Creation already handled by Gateway)
        update_task_status(task_id, org_id, 'running', session_id=session_id)

        # 2. Invoke LangGraph Orchestrator
        initial_state = {
            "task_id": task_id,
            "org_id": org_id,
            "user_id": user_id,
            "session_id": session_id,
            "prompt": prompt,
            "action": action,
            "resources": resources,
            "agent_type": "",
            "result": {}
        }
        
        from graph import run_orchestrator_graph_with_state
        # Pass session_id as LangGraph thread_id for conversation memory
        config = {"configurable": {"thread_id": session_id}}
        
        # This call now handles its own finalization (DB update + WebSocket push)
        run_orchestrator_graph_with_state(initial_state, config)

        print(f" [x] Orchestration execution finished for task: {task_id}")
        ch.basic_ack(delivery_tag=method.delivery_tag)


    except Exception as e:
        print(f" [!] Error in Orchestrator: {e}")
        update_task_status(task_id, org_id, 'failed', session_id=session_id, error_message=str(e))
        
        # Implement retry logic
        headers = properties.headers or {}
        # Use specific routing key for retry to maintain org affinity
        routing_key = f"tasks.{org_id}"
        if not publish_with_retry(ch, routing_key, data, headers):
            # Max retries reached
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    # Consume with wildcards for all orgs
    mq_client.consume(QUEUE_NAME, callback, routing_key='tasks.#')

if __name__ == '__main__':
    main()
