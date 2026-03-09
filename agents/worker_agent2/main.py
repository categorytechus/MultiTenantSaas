import os
import json
import pika
from dotenv import load_dotenv
from common.rabbitmq import RabbitMQClient, publish_with_retry

load_dotenv()

QUEUE_NAME = 'worker_agent2_tasks'
ROUTING_KEY = 'agents.worker_agent2'
mq_client = RabbitMQClient()

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

llm = ChatOpenAI(model="gpt-4o", temperature=0.2)

def callback(ch, method, properties, body):
    """Process incoming messages and return result via RPC"""
    print(f" [x] Received {body}")
    
    try:
        payload = json.loads(body)
        org_id = payload.get('org_id')
        prompt_text = payload.get('prompt', '')
        
        print(f"Processing enrollment task for Org: {org_id}")
        
        # Real OpenAI logic for Enrollment
        enroll_prompt = ChatPromptTemplate.from_template("""
        You are an Enrollment and HR specialist.
        Handle the following request regarding enrollment, payroll, or benefits.
        
        User Request: {input}
        
        Provide a professional response.
        """)
        
        chain = enroll_prompt | llm | StrOutputParser()
        answer = chain.invoke({"input": prompt_text})

        result = {
            "status": "success",
            "agent": "EnrollmentAgent (OpenAI)",
            "answer": answer,
            "org_id": org_id
        }
        
        # Send response back if reply_to is specified (RPC)
        if properties.reply_to:
            ch.basic_publish(
                exchange='',
                routing_key=properties.reply_to,
                properties=pika.BasicProperties(correlation_id=properties.correlation_id),
                body=json.dumps(result)
            )
        
        print(f" [x] Done. Result: {result}")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    print("Enrollment agent starting...")
    mq_client.consume(QUEUE_NAME, callback, routing_key=ROUTING_KEY)

if __name__ == '__main__':
    main()
