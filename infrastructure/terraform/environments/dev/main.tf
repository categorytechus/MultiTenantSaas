module "cloudwatch" {
  source = "../../modules/cloudwatch"
  
  project_name       = var.project_name
  environment        = var.environment
  log_retention_days = 30
}

module "cloudtrail" {
  source = "../../modules/cloudtrail"
  
  project_name   = var.project_name
  environment    = var.environment
  retention_days = var.cloudtrail_retention_days
}

module "secrets" {
  source = "../../modules/secrets-manager"
  
  project_name     = var.project_name
  environment      = var.environment
  db_password      = var.db_password
  jwt_secret       = var.jwt_secret
  openai_api_key   = var.openai_api_key
}

module "s3" {
  source = "../../modules/s3"
  
  bucket_name     = "${var.project_name}-documents-${var.environment}"
  environment     = var.environment
  allowed_origins = ["http://localhost:3000", "http://localhost:4000"]
  
  tags = {
    Project = var.project_name
  }
}

# Add Bedrock Knowledge Base module
module "bedrock_kb" {
  source = "../../modules/bedrock-kb"

  environment          = var.environment
  aws_region          = var.aws_region
  documents_bucket_arn = module.s3.documents_bucket_arn

  common_tags = var.common_tags
}

# Add outputs
output "knowledge_base_id" {
  value = module.bedrock_kb.knowledge_base_id
}

output "data_source_id" {
  value = module.bedrock_kb.data_source_id
}

variable "common_tags" {
  description = "Common tags applied to all resources"
  type        = map(string)

  default = {
    Project     = "multi-tenant-saas"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

