output "log_group_names" {
  description = "Map of service names to log group names"
  value = {
    for service, log_group in aws_cloudwatch_log_group.application_logs :
    service => log_group.name
  }
}

output "log_group_arns" {
  description = "Map of service names to log group ARNs"
  value = {
    for service, log_group in aws_cloudwatch_log_group.application_logs :
    service => log_group.arn
  }
}

output "eks_cluster_log_group_name" {
  description = "EKS cluster log group name"
  value       = aws_cloudwatch_log_group.eks_cluster.name
}

output "eks_application_log_group_name" {
  description = "EKS application log group name"
  value       = aws_cloudwatch_log_group.eks_application.name
}