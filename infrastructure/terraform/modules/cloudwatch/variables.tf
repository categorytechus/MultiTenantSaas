variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "service_names" {
  description = "List of service names for log groups"
  type        = list(string)
  default     = [
    "frontend",
    "auth",
    "counselor-agent",
    "enrollment-agent",
    "support-agent",
    "orchestrator",
    "postgres",
    "rabbitmq"
  ]
}

variable "log_retention_days" {
  description = "Number of days to retain logs"
  type        = number
  default     = 30
}