data "aws_caller_identity" "current" {}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  ssh_public_key_path = var.ssh_public_key_path != "" ? var.ssh_public_key_path : "${path.module}/${var.key_name}.pub"
}

resource "aws_key_pair" "app" {
  key_name   = var.key_name
  public_key = file(local.ssh_public_key_path)
}

resource "aws_instance" "app" {
  ami                  = data.aws_ami.amazon_linux_2023.id
  instance_type        = var.ec2_instance_type
  subnet_id            = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name             = aws_key_pair.app.key_name
  iam_instance_profile = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  # Increase IMDS hop limit to 2 so Docker containers can reach the IAM
  # credentials endpoint (169.254.169.254). The default limit of 1 blocks
  # any request that goes through a Docker network hop.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  user_data = file("${path.module}/userdata.sh")

  tags = { Name = "${local.name_prefix}-app" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = { Name = "${local.name_prefix}-eip" }
}

resource "aws_lb_target_group_attachment" "app" {
  target_group_arn = aws_lb_target_group.frontend.arn
  target_id        = aws_instance.app.id
  port             = 3000
}

