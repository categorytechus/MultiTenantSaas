variable "aws_region" {
  description = "AWS region"
  type        = "string"
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for tagging"
  type        = "string"
  default     = "multi-tenant-saas"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = "string"
  default     = "t3.medium" # Minimal for k3s + workloads
}
