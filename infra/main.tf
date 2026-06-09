terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Partial backend config — bucket/region/key are supplied at init time.
  # Run:  terraform -chdir=infra init -reconfigure -backend-config=<client-dir>/backend.hcl
  # Or:   make tf-init CLIENT=<client-id>
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  endpoints {
    s3 = "https://s3.${var.aws_region}.amazonaws.com"
  }

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}
