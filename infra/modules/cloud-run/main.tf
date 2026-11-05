# Dedicated runtime service account for the Realtime Gateway container
resource "google_service_account" "gateway_sa" {
  account_id   = "meetyou-${var.environment}-gateway-sa"
  display_name = "MeetYou ${var.environment} Gateway Service Account"
  project      = var.project_id
}

# Grant Cloud SQL client role for private DB access
resource "google_project_iam_member" "sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.gateway_sa.email}"
}

# Cloud Run v2 Service for the Realtime Gateway
resource "google_cloud_run_v2_service" "gateway" {
  name     = "meetyou-${var.environment}-gateway"
  location = var.region
  project  = var.project_id

  template {
    service_account = google_service_account.gateway_sa.email
    timeout         = "3600s" # 60-minute long-lived WebSocket sessions (ADR-0002)

    # Reconnecting clients during a call hit the same gateway instance
    session_affinity = true

    scaling {
      min_instance_count = 0 # Scale to 0 when idle in staging to eliminate idle costs
      max_instance_count = 3
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.gateway_image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      # The gateway reads APP_ENV; it refuses to start outside local/ci until S2 sign-in exists.
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

# Allow incoming client traffic to the Gateway service (WSS connections from extension)
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

