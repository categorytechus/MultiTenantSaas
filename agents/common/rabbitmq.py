import os
import pika
import json
import time
from typing import Callable

RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://admin:admin@localhost:5672')
DEFAULT_EXCHANGE = 'saas_exchange'

class RabbitMQClient:
    def __init__(self, url: str = RABBITMQ_URL):
        self.url = url
        self.connection = None
        self.channel = None

    def connect(self):
        """Connect with retry logic"""
        while True:
            try:
                print(f"Connecting to RabbitMQ at {self.url}...")
                params = pika.URLParameters(self.url)
                self.connection = pika.BlockingConnection(params)
                self.channel = self.connection.channel()
                
                # Declare standard topology
                self.channel.exchange_declare(exchange=DEFAULT_EXCHANGE, exchange_type='topic', durable=True)
                self.channel.exchange_declare(exchange='dlx', exchange_type='direct', durable=True)
                
                print("Connected to RabbitMQ")
                break
            except pika.exceptions.AMQPConnectionError as e:
                print(f"Connection failed: {e}. Retrying in 5 seconds...")
                time.sleep(5)

    def publish(self, routing_key: str, body: dict, exchange: str = DEFAULT_EXCHANGE):
        """Publish a message with persistence"""
        if not self.channel or self.channel.is_closed:
            self.connect()
            
        self.channel.basic_publish(
            exchange=exchange,
            routing_key=routing_key,
            body=json.dumps(body),
            properties=pika.BasicProperties(
                delivery_mode=2,  # make message persistent
            )
        )
        print(f" [x] Sent to {routing_key}: {json.dumps(body)[:100]}...")

    def call(self, routing_key: str, body: dict, exchange: str = DEFAULT_EXCHANGE, timeout: int = 30):
        """Synchronous RPC call"""
        if not self.channel or self.channel.is_closed:
            self.connect()

        # Declare an exclusive callback queue
        result = self.channel.queue_declare(queue='', exclusive=True)
        callback_queue = result.method.queue

        response = None
        corr_id = str(json.dumps(body).__hash__()) # Simple correlation ID

        def on_response(ch, method, props, body):
            nonlocal response
            if props.correlation_id == corr_id:
                response = json.loads(body)

        self.channel.basic_consume(
            queue=callback_queue,
            on_message_callback=on_response,
            auto_ack=True
        )

        self.channel.basic_publish(
            exchange=exchange,
            routing_key=routing_key,
            properties=pika.BasicProperties(
                reply_to=callback_queue,
                correlation_id=corr_id,
            ),
            body=json.dumps(body)
        )

        start_time = time.time()
        while response is None:
            self.connection.process_data_events(time_limit=1)
            if time.time() - start_time > timeout:
                raise TimeoutError(f"RPC call to {routing_key} timed out after {timeout}s")

        return response

    def consume(self, queue_name: str, callback: Callable, exchange: str = DEFAULT_EXCHANGE, routing_key: str = None, durable: bool = True):
        """Consume messages from a queue, optionally binding it to an exchange"""
        if not self.channel or self.channel.is_closed:
            self.connect()

        # Ensure queue exists and is bound to DLX
        self.channel.queue_declare(
            queue=queue_name, 
            durable=durable, 
            arguments={'x-dead-letter-exchange': 'dlx'}
        )

        if routing_key:
            self.channel.queue_bind(exchange=exchange, queue=queue_name, routing_key=routing_key)
            print(f" [*] Bound {queue_name} to {exchange} with {routing_key}")
        
        self.channel.basic_qos(prefetch_count=1)
        self.channel.basic_consume(queue=queue_name, on_message_callback=callback)
        
        print(f' [*] Waiting for messages on {queue_name}. To exit press CTRL+C')
        try:
            self.channel.start_consuming()
        except KeyboardInterrupt:
            self.close()

    def close(self):
        if self.connection and not self.connection.is_closed:
            self.connection.close()

def get_retry_count(properties):
    """Extract retry count from headers"""
    headers = properties.headers or {}
    return headers.get('x-retry-count', 0)

def publish_with_retry(channel, routing_key, body, headers=None, max_retries=3):
    """
    Publishes a message with an incremented retry counter.
    If max_retries is reached, the message can be dead-lettered or dropped.
    """
    headers = headers or {}
    retry_count = headers.get('x-retry-count', 0)
    
    if retry_count >= max_retries:
        print(f" [!] Max retries reached for message. Moving to DLQ...")
        # Note: If bound to DLX, nack with requeue=False will move it there
        return False

    new_headers = headers.copy()
    new_headers['x-retry-count'] = retry_count + 1
    
    channel.basic_publish(
        exchange=DEFAULT_EXCHANGE,
        routing_key=routing_key,
        body=json.dumps(body),
        properties=pika.BasicProperties(
            delivery_mode=2,
            headers=new_headers
        )
    )
    print(f" [x] Republished to {routing_key} (Retry {retry_count + 1}/{max_retries})")
    return True
