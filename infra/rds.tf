resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name_prefix}-rds-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${local.name_prefix}-rds-subnet-group" }
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name_prefix}-pg16"
  family = "postgres16"

  tags = { Name = "${local.name_prefix}-pg16" }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-postgres"

  engine               = "postgres"
  engine_version       = "16"
  instance_class       = var.db_instance_class
  allocated_storage    = 20
  max_allocated_storage = 100
  storage_type         = "gp3"
  storage_encrypted    = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  deletion_protection = false
  skip_final_snapshot = false
  final_snapshot_identifier = "${local.name_prefix}-final-snapshot"

  tags = { Name = "${local.name_prefix}-postgres" }
}
