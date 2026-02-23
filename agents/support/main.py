"""
Support Agent - Strands-based agent for support workflows.

Handles: triage -> resolve -> escalate
"""

import os
from dotenv import load_dotenv

load_dotenv()

RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://admin:admin@localhost:5672')
QUEUE_NAME = 'tasks'


def process_support(payload):
    """
    Process a support task using Strands.
    Placeholder - implement Strands agent here.
    """
    print(" -> Running Support Agent")
    return {"status": "success", "agent": "Support"}


if __name__ == '__main__':
    print("Support agent starting...")
    # TODO: Connect to RabbitMQ and consume support tasks
