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
