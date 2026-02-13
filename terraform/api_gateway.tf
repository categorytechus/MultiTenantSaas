# REST API
resource "aws_api_gateway_rest_api" "main" {
  name        = "${var.project_name}-rest-api"
  description = "REST API for Multi-Tenant SaaS"
}

# /api resource
resource "aws_api_gateway_resource" "api" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "api"
}

# Define resources: agents, users, orgs
variable "api_resources" {
  type    = list(string)
  default = ["agents", "users", "orgs", "validate-permissions"]
}

resource "aws_api_gateway_resource" "resources" {
  for_each    = toset(var.api_resources)
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = each.value
}

resource "aws_api_gateway_authorizer" "auth" {
  name                   = "${var.project_name}-authorizer"
  rest_api_id            = aws_api_gateway_rest_api.main.id
  authorizer_uri         = aws_lambda_function.authorizer.invoke_arn
  authorizer_result_ttl_in_seconds = 300
  type                   = "TOKEN"
  identity_source        = "method.request.header.Authorization"
}

# ANY method for each resource integration with Lambda
resource "aws_api_gateway_method" "methods" {
  for_each      = toset(var.api_resources)
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.resources[each.value].id
  http_method   = "ANY"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.auth.id
}

resource "aws_api_gateway_integration" "integrations" {
  for_each                = toset(var.api_resources)
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.resources[each.value].id
  http_method             = aws_api_gateway_method.methods[each.value].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.orchestrator.invoke_arn
}

# Deployment and Stage for REST
resource "aws_api_gateway_deployment" "rest" {
  depends_on = [aws_api_gateway_integration.integrations]
  rest_api_id = aws_api_gateway_rest_api.main.id
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.rest.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = "prod"
}

# --- WebSocket API ---

resource "aws_apigatewayv2_api" "ws" {
  name                       = "${var.project_name}-ws-api"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_authorizer" "ws_auth" {
  api_id           = aws_apigatewayv2_api.ws.id
  authorizer_type  = "REQUEST"
  authorizer_uri   = aws_lambda_function.authorizer.invoke_arn
  identity_sources = ["route.request.header.Authorization"]
  name             = "${var.project_name}-ws-authorizer"
}

resource "aws_apigatewayv2_integration" "ws_lambda" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.api_stub.invoke_arn
}

# Default routes for WebSocket
resource "aws_apigatewayv2_route" "connect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_lambda.id}"
  
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.ws_auth.id
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_lambda.id}"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ws_lambda.id}"
}

# Task status streaming route
resource "aws_apigatewayv2_route" "task_status" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "task-status"
  target    = "integrations/${aws_apigatewayv2_integration.ws_lambda.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = "prod"
  auto_deploy = true
}
