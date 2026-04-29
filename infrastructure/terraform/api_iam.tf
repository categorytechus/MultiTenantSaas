# IAM Policy for API Access
# This policy allows services or developers to execute the SaaS APIs

resource "aws_iam_policy" "api_access" {
  name        = "${var.project_name}-api-access"
  path        = "/"
  description = "Allows access to MultiTenantSaas API Gateway endpoints"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "execute-api:Invoke"
        ]
        Effect   = "Allow"
        Resource = "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*/*/*/*"
      }
    ]
  })
}

resource "aws_iam_role" "api_gateway_executor" {
  name = "${var.project_name}-api-executor"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = data.aws_caller_identity.current.arn
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "api_access_attach" {
  role       = aws_iam_role.api_gateway_executor.name
  policy_arn = aws_iam_policy.api_access.arn
}

data "aws_caller_identity" "current" {}
