resource "google_storage_bucket" "audio_chunks" {
  name          = "${var.bucket_name_prefix}-${var.environment}-${var.project_id}"
  location      = var.region
  project       = var.project_id
  storage_class = "STANDARD"

  # Prevent accidental public exposure of meeting recordings
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Retention Policy (D-02): Raw audio and video fragments deleted after N days
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = var.retention_days
    }
  }

  # CORS configuration for signed PUT uploads from client surfaces (ADR-0011 video chunks)
  cors {
    origin          = ["https://meet.google.com"]
    method          = ["PUT", "GET", "OPTIONS"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "meetyou"
  }
}

