output "cloudtrail_id" {
  description = "CloudTrail ID"
  value       = aws_cloudtrail.main.id
}

output "cloudtrail_arn" {
  description = "CloudTrail ARN"
  value       = aws_cloudtrail.main.arn
}

output "s3_bucket_name" {
  description = "S3 bucket name for CloudTrail logs"
  value       = aws_s3_bucket.cloudtrail.id
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN for CloudTrail logs"
  value       = aws_s3_bucket.cloudtrail.arn
}