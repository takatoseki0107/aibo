terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.0"
}

data "aws_caller_identity" "current" {}

provider "aws" {
  region  = "ap-northeast-1"
  profile = var.aws_profile
}

resource "aws_dynamodb_table" "household" {
  name         = "household-transactions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "transactionId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "transactionId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = "household-transactions"
    Environment = var.environment
  }
}

resource "aws_cognito_user_pool" "household" {
  name = "household-user-pool-${var.environment}"

  password_policy {
    minimum_length    = 6
    require_uppercase = true
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
  }

  auto_verified_attributes = ["email"]

  deletion_protection = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "【家計管理API】メールアドレスの確認"
    email_message        = "確認コード: {####}"
  }

  # schema追加はUser Pool再作成が必要なため、新規環境でのみ有効
  # schema {
  #   name                     = "name"
  #   attribute_data_type      = "String"
  #   mutable                  = true
  #   required                 = false
  #   string_attribute_constraints {
  #     min_length = 1
  #     max_length = 50
  #   }
  # }

  tags = {
    Name        = "household-user-pool-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_cognito_user_pool_client" "household" {
  name         = "household-app-client"
  user_pool_id = aws_cognito_user_pool.household.id

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

resource "aws_iam_role" "lambda" {
  name = "household-lambda-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
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

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "household" {
  filename         = "${path.module}/../lambda.zip"
  function_name    = "household-api-${var.environment}"
  role             = aws_iam_role.lambda.arn
  handler          = "main.handler"
  runtime          = "python3.12"
  source_code_hash = filebase64sha256("${path.module}/../lambda.zip")
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      SNS_TOPIC_ARN    = aws_sns_topic.budget_alert.arn
      BEDROCK_MODEL_ID = "jp.anthropic.claude-haiku-4-5-20251001-v1:0"
      BUDGET_THRESHOLD = tostring(var.budget_threshold)
    }
  }

  tags = {
    Name        = "household-api-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_api" "household" {
  name          = "household-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "household" {
  api_id                 = aws_apigatewayv2_api.household.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.household.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "household" {
  api_id           = aws_apigatewayv2_api.household.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "household-cognito-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.household.id]
    issuer   = "https://cognito-idp.ap-northeast-1.amazonaws.com/${aws_cognito_user_pool.household.id}"
  }
}

resource "aws_apigatewayv2_route" "household" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "GET /"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_apigatewayv2_stage" "household" {
  api_id      = aws_apigatewayv2_api.household.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_lambda_permission" "household" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.household.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.household.execution_arn}/*/*"
}

resource "aws_iam_policy" "lambda_dynamodb" {
  name = "household-lambda-dynamodb-policy-${var.environment}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.household.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_dynamodb" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.lambda_dynamodb.arn
}

resource "aws_apigatewayv2_route" "post_transactions" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "POST /transactions"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_apigatewayv2_route" "get_transactions" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "GET /transactions"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_apigatewayv2_route" "get_transactions_summary" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "GET /transactions/summary"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_apigatewayv2_route" "delete_transaction" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "DELETE /transactions/{transactionId}"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_apigatewayv2_route" "put_transaction" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "PUT /transactions/{transactionId}"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_iam_policy" "lambda_bedrock" {
  name = "household-lambda-bedrock-policy-${var.environment}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = [
          "arn:aws:bedrock:ap-northeast-1:${data.aws_caller_identity.current.account_id}:inference-profile/jp.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_bedrock" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.lambda_bedrock.arn
}

resource "aws_apigatewayv2_route" "get_advice" {
  api_id             = aws_apigatewayv2_api.household.id
  route_key          = "GET /transactions/advice"
  target             = "integrations/${aws_apigatewayv2_integration.household.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.household.id
}

resource "aws_sns_topic" "budget_alert" {
  name = "household-budget-alert-${var.environment}"

  tags = {
    Name        = "household-budget-alert-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "budget_alert_email" {
  topic_arn = aws_sns_topic.budget_alert.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_iam_policy" "lambda_sns" {
  name = "household-lambda-sns-policy-${var.environment}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.budget_alert.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_sns" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.lambda_sns.arn
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/household-api-${var.environment}"
  retention_in_days = 30

  tags = {
    Name        = "household-api-logs-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "household-lambda-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "Lambda関数でエラーが発生しました"
  alarm_actions       = [aws_sns_topic.ops_alert.arn]

  dimensions = {
    FunctionName = aws_lambda_function.household.function_name
  }

  tags = {
    Name        = "household-lambda-errors-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "bedrock_invocations" {
  alarm_name          = "household-bedrock-invocations-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Invocations"
  namespace           = "AWS/Bedrock"
  period              = 3600
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "Bedrock呼び出し回数が1時間で100回を超えました"
  alarm_actions       = [aws_sns_topic.ops_alert.arn]

  dimensions = {
    ModelId = "jp.anthropic.claude-haiku-4-5-20251001-v1:0"
  }

  tags = {
    Name        = "household-bedrock-invocations-${var.environment}"
    Environment = var.environment
  }
}

# 運用アラート（Lambdaエラー・Bedrockアラーム）用トピック
resource "aws_sns_topic" "ops_alert" {
  name = "household-ops-alert-${var.environment}"

  tags = {
    Name        = "household-ops-alert-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "ops_alert_email" {
  topic_arn = aws_sns_topic.ops_alert.arn
  protocol  = "email"
  endpoint  = var.alert_email
}


