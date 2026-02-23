import os
import pika
import json
import time
from dotenv import load_dotenv
from agent_graph import invoke_agent

# Load environment variables
load_dotenv()

RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://admin:admin@localhost:5672')
QUEUE_NAME = 'tasks'

def connect_to_rabbitmq():
    """Connect to RabbitMQ with retry logic"""
    while True:
        try:
            print(f"Connecting to RabbitMQ at {RABBITMQ_URL}...")
            params = pika.URLParameters(RABBITMQ_URL)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            
            # Ensure topology (Consumer should also declare strictly to avoid errors)
            channel.queue_declare(queue=QUEUE_NAME, durable=True, arguments={'x-dead-letter-exchange': 'dlx'})
            
            print("Connected to RabbitMQ")
            return connection, channel
        except pika.exceptions.AMQPConnectionError as e:
            print(f"Connection failed: {e}. Retrying in 5 seconds...")
            time.sleep(5)

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
        # Dead letter or discard? For now, ack to remove malformed message
        ch.basic_ack(delivery_tag=method.delivery_tag) 
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        # Reject and requeue (or dead letter if x-death count high)
        # ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False) 
        ch.basic_ack(delivery_tag=method.delivery_tag) # Ack to prevent loop for now

def main():
    connection, channel = connect_to_rabbitmq()
    
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=QUEUE_NAME, on_message_callback=callback)
    
    print(' [*] Waiting for messages. To exit press CTRL+C')
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print('Interrupted')
        try:
            connection.close()
        except:
            pass

if __name__ == '__main__':
    main()
