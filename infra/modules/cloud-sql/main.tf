resource "google_sql_database_instance" "postgres" {
  name             = "meetyou-${var.environment}-pg16"
  project          = var.project_id
  region           = var.region
  database_version = var.database_version

  # Off in staging so the environment can be rebuilt from scratch; production sets it to true.
  deletion_protection = false

  depends_on = [var.vpc_peering_dependency]

  settings {
    tier              = var.tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL" # Single zone for cost efficiency in staging (ADR-0002)
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.private_network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = false # Enable for prod; keep false in staging to minimize cost
      backup_retention_settings {
        retained_backups = 7
      }
    }

    insights_config {
      query_insights_enabled = true
    }

    user_labels = {
      environment = var.environment
      managed_by  = "terraform"
      project     = "meetyou"
    }
  }
}

resource "google_sql_database" "app_db" {
  name     = "meetyou_${var.environment}"
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app_user" {
  name     = "meetyou_app"
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}

