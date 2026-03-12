# infrastructure/terraform/modules/s3/outputs.tf

output "bucket_id" {
  description = "The ID of the S3 bucket"
  value       = aws_s3_bucket.documents.id
}

output "bucket_arn" {
  description = "The ARN of the S3 bucket"
  value       = aws_s3_bucket.documents.arn
}

output "bucket_name" {
  description = "The name of the S3 bucket"
  value       = aws_s3_bucket.documents.bucket
}

output "bucket_region" {
  description = "The AWS region of the S3 bucket"
  value       = aws_s3_bucket.documents.region
}

output "documents_bucket_arn" {
  description = "ARN of the documents S3 bucket"
  value       = aws_s3_bucket.documents.arn
}
