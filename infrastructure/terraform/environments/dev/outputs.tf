# CloudWatch Outputs
output "cloudwatch_log_groups" {
  description = "CloudWatch log group names"
  value       = module.cloudwatch.log_group_names
}

# CloudTrail Outputs
output "cloudtrail_id" {
  description = "CloudTrail ID"
  value       = module.cloudtrail.cloudtrail_id
}

output "cloudtrail_s3_bucket" {
  description = "S3 bucket for CloudTrail logs"
  value       = module.cloudtrail.s3_bucket_name
}

# Secrets Manager Outputs
output "secrets_created" {
  description = "List of secrets created in AWS Secrets Manager"
  sensitive = true
  value = {
    db_password      = module.secrets.db_password_secret_name
    jwt_secret       = module.secrets.jwt_secret_name
    openai_api_key   = module.secrets.openai_api_key_name
    rabbitmq_password = module.secrets.rabbitmq_password_secret_name
  }
}