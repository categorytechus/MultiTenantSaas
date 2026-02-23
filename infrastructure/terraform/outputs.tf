output "ec2_public_ip" {
  value       = aws_instance.k3s_server.public_ip
  description = "Public IP of the EC2 instance"
}

output "api_url" {
  value       = "http://${aws_instance.k3s_server.public_ip}/api"
  description = "API base URL via Traefik Ingress"
}

output "db_password_secret_name" {
  value = aws_secretsmanager_secret.db_password.name
}

output "jwt_key_secret_name" {
  value = aws_secretsmanager_secret.jwt_key.name
}

output "llm_keys_secret_name" {
  value = aws_secretsmanager_secret.llm_keys.name
}

output "cloudtrail_bucket" {
  value = aws_s3_bucket.cloudtrail.id
}

output "aws_region" {
  value       = var.aws_region
  description = "AWS region used for deployment"
}

output "auth_service_repository_url" {
  value       = aws_ecr_repository.auth_service.repository_url
  description = "ECR repository URL for auth-service"
}

output "orchestrator_service_repository_url" {
  value       = aws_ecr_repository.orchestrator_service.repository_url
  description = "ECR repository URL for orchestrator-service"
}

output "task_status_service_repository_url" {
  value       = aws_ecr_repository.task_status_service.repository_url
  description = "ECR repository URL for task-status-service"
}

output "ecr_registry_url" {
  value       = split("/", aws_ecr_repository.auth_service.repository_url)[0]
  description = "ECR registry URL (account.dkr.ecr.region.amazonaws.com)"
}
