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

resource "aws_key_pair" "app" {
  key_name   = var.key_name
  public_key = file("${path.module}/${var.key_name}.pub")
}

resource "aws_instance" "app" {
  ami                  = data.aws_ami.amazon_linux_2023.id
  instance_type        = var.ec2_instance_type
  subnet_id            = aws_subnet.public[0].id
  security_groups      = [aws_security_group.ec2.id]
  key_name             = aws_key_pair.app.key_name
  iam_instance_profile = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
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
