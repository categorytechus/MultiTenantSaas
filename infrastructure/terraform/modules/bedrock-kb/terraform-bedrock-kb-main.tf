############################################
# Bedrock Knowledge Base + OpenSearch Setup
############################################

locals {
  collection_name = "${var.environment}-kb-vectors"
}

data "aws_caller_identity" "current" {}

############################################
# OpenSearch Encryption Policy
############################################

resource "aws_opensearchserverless_security_policy" "encryption" {
  name = "${var.environment}-kb-encryption-policy"
  type = "encryption"

  policy = jsonencode({
    Rules = [{
      ResourceType = "collection"
      Resource     = ["collection/${local.collection_name}"]
    }]
    AWSOwnedKey = true
  })
}

############################################
# OpenSearch Network Policy
############################################

resource "aws_opensearchserverless_security_policy" "network" {
  name = "${var.environment}-kb-network-policy"
  type = "network"

  policy = jsonencode([{
    Rules = [{
      ResourceType = "collection"
      Resource     = ["collection/${local.collection_name}"]
    }]
    AllowFromPublic = true
  }])
}

############################################
# OpenSearch Vector Collection
############################################

resource "aws_opensearchserverless_collection" "knowledge_base" {
  name = local.collection_name
  type = "VECTORSEARCH"

  tags = merge(var.common_tags, {
    Name = local.collection_name
  })

  depends_on = [
    aws_opensearchserverless_security_policy.encryption,
    aws_opensearchserverless_security_policy.network
  ]
}

############################################
# IAM Role for Bedrock KB
############################################

resource "aws_iam_role" "bedrock_kb_role" {
  name = "${var.environment}-bedrock-kb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "sts:AssumeRole"

      Principal = {
        Service = "bedrock.amazonaws.com"
      }

      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }

        ArnLike = {
          "aws:SourceArn" = "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*"
        }
      }
    }]
  })

  tags = var.common_tags
}

############################################
# Bedrock S3 Access
############################################

resource "aws_iam_role_policy" "bedrock_s3_policy" {
  name = "bedrock-s3-access"
  role = aws_iam_role.bedrock_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"

      Action = [
        "s3:GetObject",
        "s3:ListBucket"
      ]

      Resource = [
        var.documents_bucket_arn,
        "${var.documents_bucket_arn}/*"
      ]
    }]
  })
}

############################################
# Bedrock OpenSearch Access
############################################

resource "aws_iam_role_policy" "bedrock_opensearch_policy" {
  name = "bedrock-opensearch-access"
  role = aws_iam_role.bedrock_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [{
      Effect = "Allow"

      Action = [
        "aoss:APIAccessAll"
      ]

      Resource = [
        aws_opensearchserverless_collection.knowledge_base.arn
      ]
    }]
  })
}

############################################
# Bedrock Model Access
############################################

resource "aws_iam_role_policy" "bedrock_model_policy" {
  name = "bedrock-model-access"
  role = aws_iam_role.bedrock_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [{
      Effect = "Allow"

      Action = [
        "bedrock:InvokeModel"
      ]

      Resource = [
        "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v1"
      ]
    }]
  })
}

############################################
# OpenSearch Data Access Policy
############################################

resource "aws_opensearchserverless_access_policy" "data_access" {
  name = "${var.environment}-kb-data-access"
  type = "data"

  policy = jsonencode([{

    Rules = [

      {
        ResourceType = "collection"
        Resource     = ["collection/${local.collection_name}"]

        Permission = [
          "aoss:CreateCollectionItems",
          "aoss:UpdateCollectionItems",
          "aoss:DescribeCollectionItems"
        ]
      },

      {
        ResourceType = "index"
        Resource     = ["index/${local.collection_name}/*"]

        Permission = [
          "aoss:CreateIndex",
          "aoss:UpdateIndex",
          "aoss:DescribeIndex",
          "aoss:ReadDocument",
          "aoss:WriteDocument"
        ]
      }

    ]

    Principal = [
      aws_iam_role.bedrock_kb_role.arn,
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
    ]

  }])

  depends_on = [
    aws_opensearchserverless_collection.knowledge_base
  ]
}

############################################
# Bedrock Knowledge Base
############################################

resource "aws_bedrockagent_knowledge_base" "main" {
  name        = "${var.environment}-document-kb"
  description = "Knowledge base for multi-tenant SaaS documents"

  role_arn = aws_iam_role.bedrock_kb_role.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v1"
    }
  }

  storage_configuration {
    type = "OPENSEARCH_SERVERLESS"

    opensearch_serverless_configuration {
      collection_arn    = aws_opensearchserverless_collection.knowledge_base.arn
      vector_index_name = "bedrock-knowledge-base-default-index"

      field_mapping {
        vector_field   = "bedrock-knowledge-base-default-vector"
        text_field     = "AMAZON_BEDROCK_TEXT_CHUNK"
        metadata_field = "AMAZON_BEDROCK_METADATA"
      }
    }
  }

  tags = var.common_tags

  depends_on = [
    aws_opensearchserverless_access_policy.data_access,
    aws_iam_role_policy.bedrock_s3_policy,
    aws_iam_role_policy.bedrock_opensearch_policy,
    aws_iam_role_policy.bedrock_model_policy
  ]
}

############################################
# Bedrock Data Source (S3)
############################################

resource "aws_bedrockagent_data_source" "s3_documents" {
  name              = "${var.environment}-s3-documents"
  knowledge_base_id = aws_bedrockagent_knowledge_base.main.id

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn = var.documents_bucket_arn
    }
  }

  vector_ingestion_configuration {

    chunking_configuration {

      chunking_strategy = "FIXED_SIZE"

      fixed_size_chunking_configuration {
        max_tokens         = 300
        overlap_percentage = 20
      }
    }
  }

  depends_on = [
    aws_bedrockagent_knowledge_base.main
  ]
}