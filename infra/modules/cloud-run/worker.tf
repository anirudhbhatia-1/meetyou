# Dedicated runtime service account for the async Background Worker (video.finalize, retention)
resource "google_service_account" "worker_sa" {
  account_id   = "meetyou-${var.environment}-worker-sa"
  display_name = "MeetYou ${var.environment} Background Worker Service Account"
  project      = var.project_id
}

# Grant Cloud SQL client role for private DB access
resource "google_project_iam_member" "worker_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.worker_sa.email}"
}

# Grant Storage Object User on the audio/video bucket (reads fragments, writes playback.mp4, deletes fragments)
resource "google_storage_bucket_iam_member" "worker_storage_user" {
  bucket = var.audio_bucket_name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.worker_sa.email}"
}

# Cloud Run v2 Service for the Background Worker (ADR-0005, ADR-0011 §3.4)
# Note: min_instance_count = 1 and cpu_idle = false because graphile-worker polls and holds connections
resource "google_cloud_run_v2_service" "worker" {
  name     = "meetyou-${var.environment}-worker"
  location = var.region
  project  = var.project_id

  template {
    service_account = google_service_account.worker_sa.email
    timeout         = "900s" # 15 minutes for long video joins

    scaling {
      min_instance_count = 1 # Must be 1 to continuously poll the job queue
      max_instance_count = 3
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.worker_image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = false # Always-allocated CPU for background polling
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

