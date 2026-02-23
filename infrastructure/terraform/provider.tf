terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

terraform {
  backend "s3" {
    bucket = "mts-terraform-state-bucket-385143640249"
    key    = "multi-tenant-saas/terraform.tfstate"
    region = "us-east-2"
  }
}