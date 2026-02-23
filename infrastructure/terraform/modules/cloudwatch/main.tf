resource "aws_cloudwatch_log_group" "application_logs" {
  for_each = toset(var.service_names)
  
  name              = "/aws/${var.project_name}/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
  
  tags = {
    Service = each.key
  }
}

resource "aws_cloudwatch_log_group" "eks_cluster" {
  name              = "/aws/eks/${var.project_name}-${var.environment}/cluster"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "eks_application" {
  name              = "/aws/containerinsights/${var.project_name}-${var.environment}/application"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "eks_performance" {
  name              = "/aws/containerinsights/${var.project_name}-${var.environment}/performance"
  retention_in_days = var.log_retention_days
}