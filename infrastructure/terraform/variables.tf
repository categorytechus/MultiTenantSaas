variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for tagging"
  type        = string
  default     = "multi-tenant-saas"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.large"
}

variable "ami_id" {
  description = "AMI ID for the EC2 instance"
  type        = string
  default     = "ami-053b0d53c279acc90" # Ubuntu 22.04 LTS in us-east-1
}

# variable "cognito_callback_urls" {
#   description = "Callback URLs for Cognito"
#   type        = list(string)
# }

# variable "google_client_id" {
#   description = "Google OAuth client ID"
#   type        = string
# }

# variable "cognito_logout_urls" {
#   description = "Logout URLs for Cognito"
#   type        = list(string)
# }
