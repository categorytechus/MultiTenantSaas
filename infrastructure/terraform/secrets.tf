resource "aws_secretsmanager_secret" "db_password" {
  name        = "${var.project_name}-db-password"
  description = "PostgreSQL password"
  
  tags = {
    Project = var.project_name
  }
}

resource "aws_secretsmanager_secret" "jwt_key" {
  name        = "${var.project_name}-jwt-key"
  description = "JWT Secret Key"
}

resource "aws_secretsmanager_secret" "llm_keys" {
  name        = "${var.project_name}-llm-keys"
  description = "OpenAI/Anthropic API keys"
}

# IAM policy for EC2 to read these secrets
data "aws_iam_policy_document" "secrets_policy" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    effect = "Allow"
    resources = [
      aws_secretsmanager_secret.db_password.arn,
      aws_secretsmanager_secret.jwt_key.arn,
      aws_secretsmanager_secret.llm_keys.arn
    ]
  }
}

resource "aws_iam_policy" "secrets_policy" {
  name        = "${var.project_name}-secrets-policy"
  description = "Allow reading specific secrets"
  policy      = data.aws_iam_policy_document.secrets_policy.json
}

resource "aws_iam_role_policy_attachment" "secrets_attach" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.secrets_policy.arn
}
