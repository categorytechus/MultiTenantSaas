variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "multitenant-saas"
}

variable "cloudtrail_retention_days" {
  description = "Number of days to retain CloudTrail logs in S3"
  type        = number
  default     = 90
}

variable "db_password" {
  description = "Database password (will be stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret key (will be stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key (will be stored in Secrets Manager)"
  type        = string
  sensitive   = true
  default     = ""
}