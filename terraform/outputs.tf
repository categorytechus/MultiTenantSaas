output "ec2_public_ip" {
  value       = aws_instance.k3s_server.public_ip
  description = "Public IP of the EC2 instance"
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

output "rest_api_url" {
  value       = "${aws_api_gateway_stage.prod.invoke_url}/api"
  description = "REST API base URL"
}

output "ws_api_url" {
  value       = aws_apigatewayv2_stage.prod.invoke_url
  description = "WebSocket API base URL"
}
