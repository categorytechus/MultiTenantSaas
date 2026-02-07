resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-14"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../backend/lambdas/stub/index.js"
  output_path = "${path.module}/../backend/lambdas/stub.zip"
}

data "archive_file" "orchestrator_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/orchestrator"
  output_path = "${path.module}/../backend/lambdas/orchestrator.zip"
}

data "archive_file" "authorizer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/lambdas/authorizer"
  output_path = "${path.module}/../backend/lambdas/authorizer.zip"
}

resource "aws_lambda_function" "api_stub" {
  filename      = data.archive_file.lambda_zip.output_path
  function_name = "${var.project_name}-api-stub"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"

  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  runtime = "nodejs18.x"
}

resource "aws_lambda_function" "orchestrator" {
  filename      = data.archive_file.orchestrator_zip.output_path
  function_name = "${var.project_name}-orchestrator"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"

  source_code_hash = data.archive_file.orchestrator_zip.output_base64sha256

  runtime = "nodejs18.x"
}

resource "aws_lambda_function" "authorizer" {
  filename      = data.archive_file.authorizer_zip.output_path
  function_name = "${var.project_name}-authorizer"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"

  source_code_hash = data.archive_file.authorizer_zip.output_base64sha256

  runtime = "nodejs18.x"

  environment {
    variables = {
      JWT_KEY = "development-secret" # Should be synced from Secrets Manager
    }
  }
}

resource "aws_lambda_permission" "apigw_rest" {
  statement_id  = "AllowAPIGatewayInvokeREST"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.orchestrator.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_ws" {
  statement_id  = "AllowAPIGatewayInvokeWS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.orchestrator.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer_rest" {
  statement_id  = "AllowAPIGatewayInvokeAuthREST"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer_ws" {
  statement_id  = "AllowAPIGatewayInvokeAuthWS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}
