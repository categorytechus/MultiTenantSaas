from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

llm = ChatOpenAI(model="gpt-4o", temperature=0.7)

def invoke_agent(action, payload):
    """
    General purpose agent powered by OpenAI.
    """
    prompt_text = payload.get('prompt', 'Hello, how can I help you?')
    
    prompt = ChatPromptTemplate.from_template("""
    You are a helpful assistant in a Multi-Tenant SaaS platform.
    Your goal is to provide accurate and concise information.
    
    User Query: {input}
    
    Assistant:
    """)
    
    chain = prompt | llm | StrOutputParser()
    answer = chain.invoke({"input": prompt_text})
    
    return {
        "status": "success",
        "agent": "GeneralAgent (OpenAI)",
        "answer": answer
    }
