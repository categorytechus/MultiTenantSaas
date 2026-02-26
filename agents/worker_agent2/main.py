"""
Enrollment Agent - CrewAI-based agent for enrollment workflows.

Handles: check_in -> verify -> enroll -> complete
"""

import os
from dotenv import load_dotenv

load_dotenv()

RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://admin:admin@localhost:5672')
QUEUE_NAME = 'tasks'


def process_enrollment(payload):
    """
    Process an enrollment task using CrewAI.
    Placeholder - implement CrewAI crew and tasks here.
    """
    name = payload.get('data', {}).get('name', 'Unknown')
    print(f" -> Running Enrollment Agent for {name}")
    return {"status": "success", "agent": "Enrollment"}


if __name__ == '__main__':
    print("Enrollment agent starting...")
    # TODO: Connect to RabbitMQ and consume enrollment tasks
