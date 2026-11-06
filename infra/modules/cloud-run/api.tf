# Dedicated runtime service account for the REST API service
resource "google_service_account" "api_sa" {
  account_id   = "meetyou-${var.environment}-api-sa"
  display_name = "MeetYou ${var.environment} API Service Account"
  project      = var.project_id
}

# Grant Cloud SQL client role for private DB access
resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api_sa.email}"
}

# Grant Storage Object User on the audio/video bucket (signed URLs)
resource "google_storage_bucket_iam_member" "api_storage_user" {
  bucket = var.audio_bucket_name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.api_sa.email}"
}

# Grant Service Account Token Creator on itself for V4 signed URLs (ADR-0011 §3.4)
resource "google_service_account_iam_member" "api_token_creator" {
  service_account_id = google_service_account.api_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api_sa.email}"
}

# Cloud Run v2 Service for the REST API (S2-08)
resource "google_cloud_run_v2_service" "api" {
  name     = "meetyou-${var.environment}-api"
  location = var.region
  project  = var.project_id

  template {
    service_account = google_service_account.api_sa.email
    timeout         = "60s"

    scaling {
      min_instance_count = 0 # Scale to 0 when idle in staging
      max_instance_count = 3
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.api_image

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

      env {
        name  = "GCS_AUDIO_BUCKET"
        value = var.audio_bucket_name
      }
    }

    labels = {
      environment = var.environment
      managed_by  = "terraform"
      project     = "meetyou"
    }
  }
}

# Allow incoming public client traffic to the REST API
resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

