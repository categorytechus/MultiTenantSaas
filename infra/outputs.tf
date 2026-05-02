output "ec2_public_ip" {
  description = "Public IP of the app server"
  value       = aws_eip.app.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS of the app server"
  value       = aws_eip.app.public_dns
}

output "ssh_command" {
  description = "SSH command to connect to the app server"
  value       = "ssh -i infra/${var.key_name}.pem ec2-user@${aws_eip.app.public_ip}"
}

output "ecr_backend_url" {
  description = "ECR URL for the server image"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_agents_url" {
  description = "ECR URL for the agents image"
  value       = aws_ecr_repository.agents.repository_url
}

output "ecr_web_url" {
  description = "ECR URL for the web image"
  value       = aws_ecr_repository.web.repository_url
}

output "ecr_registry" {
  description = "ECR registry hostname (without repo path)"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = "${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}"
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = "${aws_elasticache_cluster.redis.cache_nodes[0].address}:${aws_elasticache_cluster.redis.cache_nodes[0].port}"
}

output "s3_bucket" {
  description = "S3 uploads bucket name"
  value       = aws_s3_bucket.uploads.id
}

output "database_url" {
  description = "Full async DATABASE_URL for the backend"
  value       = "postgresql+psycopg://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${var.db_name}"
  sensitive   = true
}

output "redis_url" {
  description = "Full REDIS_URL for the backend"
  value       = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:${aws_elasticache_cluster.redis.cache_nodes[0].port}/0"
}
