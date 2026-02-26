import os
import json
from dotenv import load_dotenv
from agent_graph import invoke_agent
from common.rabbitmq import RabbitMQClient, publish_with_retry

# Load environment variables
load_dotenv()

QUEUE_NAME = 'tasks'
mq_client = RabbitMQClient()

def callback(ch, method, properties, body):
    """Process incoming messages"""
    print(f" [x] Received {body}")
    
    try:
        payload = json.loads(body)
        org_id = payload.get('org_id')
        action = payload.get('action')
        
        print(f"Processing task for Org: {org_id}, Action: {action}")
        
        # Invoke LangGraph Agent
        result = invoke_agent(action, payload)
        
        print(f" [x] Done. Result: {result}")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        
    except json.JSONDecodeError:
        print(" [!] Failed to decode JSON")
        ch.basic_ack(delivery_tag=method.delivery_tag) 
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        # Implement retry logic
        headers = properties.headers or {}
        if not publish_with_retry(ch, QUEUE_NAME, json.loads(body), headers):
            # Max retries reached
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    mq_client.consume(QUEUE_NAME, callback)

if __name__ == '__main__':
    main()
