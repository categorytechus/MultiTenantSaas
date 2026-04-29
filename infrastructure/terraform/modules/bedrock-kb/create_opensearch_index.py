#!/usr/bin/env python3
"""
Create OpenSearch Serverless index for Bedrock Knowledge Base
Run this after the OpenSearch collection is created
"""

import boto3
import json
import sys
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

def create_index(collection_endpoint, region, index_name):
    """Create index in OpenSearch Serverless collection"""
    
    # Get credentials
    credentials = boto3.Session().get_credentials()
    auth = AWSV4SignerAuth(credentials, region, 'aoss')
    
    # Extract host from endpoint
    host = collection_endpoint.replace('https://', '')
    
    # Create OpenSearch client
    client = OpenSearch(
        hosts=[{'host': host, 'port': 443}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30
    )
    
    # Index configuration
    index_body = {
        "settings": {
            "index.knn": True
        },
        "mappings": {
            "properties": {
                "bedrock-knowledge-base-default-vector": {
                    "type": "knn_vector",
                    "dimension": 1536,
                    "method": {
                        "name": "hnsw",
                        "engine": "faiss"
                    }
                },
                "AMAZON_BEDROCK_TEXT_CHUNK": {
                    "type": "text"
                },
                "AMAZON_BEDROCK_METADATA": {
                    "type": "text"
                }
            }
        }
    }
    
    try:
        # Check if index exists
        if client.indices.exists(index=index_name):
            print(f"Index {index_name} already exists")
            return True
            
        # Create index
        response = client.indices.create(index=index_name, body=index_body)
        print(f"Index {index_name} created successfully")
        print(json.dumps(response, indent=2))
        return True
        
    except Exception as e:
        print(f"Error creating index: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python3 create_opensearch_index.py <collection_endpoint> <region> <index_name>")
        sys.exit(1)
        
    collection_endpoint = sys.argv[1]
    region = sys.argv[2]
    index_name = sys.argv[3]
    
    success = create_index(collection_endpoint, region, index_name)
    sys.exit(0 if success else 1)