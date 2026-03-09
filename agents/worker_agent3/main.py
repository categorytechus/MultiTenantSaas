import os
import json
import pika
from dotenv import load_dotenv
from common.rabbitmq import RabbitMQClient, publish_with_retry

load_dotenv()

QUEUE_NAME = 'worker_agent3_tasks'
ROUTING_KEY = 'agents.worker_agent3'
mq_client = RabbitMQClient()

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

llm = ChatOpenAI(model="gpt-4o", temperature=0.1)

def callback(ch, method, properties, body):
    """Process incoming messages and return result via RPC"""
    print(f" [x] Received {body}")
    
    try:
        payload = json.loads(body)
        org_id = payload.get('org_id')
        prompt_text = payload.get('prompt', '')
        
        print(f"Processing support task for Org: {org_id}")
        
        # Real OpenAI logic for IT Support
        support_prompt = ChatPromptTemplate.from_template("""
        You are an IT Support specialist.
        Handle the following technical support request.
        
        User Request: {input}
        
        Provide a helpful and technical response.
        """)
        
        chain = support_prompt | llm | StrOutputParser()
        answer = chain.invoke({"input": prompt_text})

        result = {
            "status": "success",
            "agent": "SupportAgent (OpenAI)",
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
    print("Support agent starting...")
    mq_client.consume(QUEUE_NAME, callback, routing_key=ROUTING_KEY)

if __name__ == '__main__':
    main()
