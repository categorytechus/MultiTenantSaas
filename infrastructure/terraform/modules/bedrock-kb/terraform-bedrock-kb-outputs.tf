output "knowledge_base_id" {
  description = "ID of the Bedrock Knowledge Base"
  value       = aws_bedrockagent_knowledge_base.main.id
}

output "knowledge_base_arn" {
  description = "ARN of the Bedrock Knowledge Base"
  value       = aws_bedrockagent_knowledge_base.main.arn
}

output "data_source_id" {
  description = "ID of the S3 data source"
  value       = aws_bedrockagent_data_source.s3_documents.id
}

output "opensearch_collection_endpoint" {
  description = "Endpoint of the OpenSearch Serverless collection"
  value       = aws_opensearchserverless_collection.knowledge_base.collection_endpoint
}

output "opensearch_collection_arn" {
  description = "ARN of the OpenSearch Serverless collection"
  value       = aws_opensearchserverless_collection.knowledge_base.arn
}

output "bedrock_role_arn" {
  description = "ARN of the IAM role used by Bedrock"
  value       = aws_iam_role.bedrock_kb_role.arn
}
