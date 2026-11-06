# Dedicated service account for executing database migrations
resource "google_service_account" "migrate_sa" {
  account_id   = "meetyou-${var.environment}-migrate-sa"
  display_name = "MeetYou ${var.environment} Migration Job Service Account"
  project      = var.project_id
}

# Grant Cloud SQL client role for private DB access
resource "google_project_iam_member" "migrate_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.migrate_sa.email}"
}

# Cloud Run v2 Job for applying database migrations (S2-01, STAGING_SETUP §6)
resource "google_cloud_run_v2_job" "migrate" {
  name     = "meetyou-${var.environment}-migrate"
  location = var.region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.migrate_sa.email
      timeout         = "600s"

      vpc_access {
        connector = var.vpc_connector_id
        egress    = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image = var.migrate_image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "APP_ENV"
          value = var.environment
        }
      }

      labels = {
        environment = var.environment
        managed_by  = "terraform"
        project     = "meetyou"
      }
    }
  }
}

