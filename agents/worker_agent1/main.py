import os
import json
from dotenv import load_dotenv
from agent_graph import invoke_agent
from common.rabbitmq import RabbitMQClient, publish_with_retry
from common.database import update_task_status as db_update_status

# Load environment variables
load_dotenv()

QUEUE_NAME = 'worker_agent1_tasks'
ROUTING_KEY = 'agents.worker_agent1'
mq_client = RabbitMQClient()

def callback(ch, method, properties, body):
    """Process incoming messages and return result via RPC"""
    print(f" [x] Received {body}")
    
    try:
        payload = json.loads(body)
        org_id = payload.get('org_id')
        action = payload.get('action')
        task_id = payload.get('task_id')
        session_id = payload.get('session_id')
        
        if not task_id:
            print(" [!] Missing task_id in payload, skipping update")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        print(f"Processing task {task_id} for Org: {org_id}, Action: {action}")
        
        # 1. Update status to 'running' (though orchestrator usually does this, extra safety)
        db_update_status(task_id, 'running')
        
        # 2. Invoke LangGraph Agent
        result = invoke_agent(action, payload)
        
        # 3. Finalize Task (Update DB + Publish WebSocket Event)
        # Update DB
        db_update_status(task_id, 'completed', result)
        
        # Publish to events exchange for WebSockets
        routing_key = f"events.{org_id}"
        mq_client.publish(routing_key, {
            "task_id": task_id,
            "session_id": session_id,
            "org_id": org_id,
            "status": "completed",
            "data": result
        })

        print(f" [x] Task {task_id} completed and finalized.")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        
    except json.JSONDecodeError:
        print(" [!] Failed to decode JSON")
        ch.basic_ack(delivery_tag=method.delivery_tag) 
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        
        # Notify DB and Frontend of failure
        try:
            payload = json.loads(body)
            task_id = payload.get('task_id')
            org_id = payload.get('org_id')
            session_id = payload.get('session_id')
            
            if task_id and org_id:
                db_update_status(task_id, 'failed', {"error": str(e)})
                mq_client.publish(f"events.{org_id}", {
                    "task_id": task_id,
                    "session_id": session_id,
                    "org_id": org_id,
                    "status": "failed",
                    "error": str(e)
                })
        except Exception as notify_err:
            print(f" [!] Failed to send error notification: {notify_err}")

        # Implement retry logic
        headers = properties.headers or {}
        if not publish_with_retry(ch, QUEUE_NAME, json.loads(body), headers):
            # Max retries reached
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    # Consume with specific routing key
    mq_client.consume(QUEUE_NAME, callback, routing_key=ROUTING_KEY)

if __name__ == '__main__':
    main()
