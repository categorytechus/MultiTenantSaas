output "db_password_secret_arn" {
  description = "ARN of the database password secret"
  value       = aws_secretsmanager_secret.db_password.arn
}

output "db_password_secret_name" {
  description = "Name of the database password secret"
  value       = aws_secretsmanager_secret.db_password.name
}

output "jwt_secret_arn" {
  description = "ARN of the JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "jwt_secret_name" {
  description = "Name of the JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.name
}

output "openai_api_key_arn" {
  description = "ARN of the OpenAI API key secret"
  value       = var.openai_api_key != "" ? aws_secretsmanager_secret.openai_api_key[0].arn : ""
}

output "openai_api_key_name" {
  description = "Name of the OpenAI API key secret"
  value       = var.openai_api_key != "" ? aws_secretsmanager_secret.openai_api_key[0].name : ""
}

output "rabbitmq_password_secret_arn" {
  description = "ARN of the RabbitMQ password secret"
  value       = aws_secretsmanager_secret.rabbitmq_password.arn
}

output "rabbitmq_password_secret_name" {
  description = "Name of the RabbitMQ password secret"
  value       = aws_secretsmanager_secret.rabbitmq_password.name
}