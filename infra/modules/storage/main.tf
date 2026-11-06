resource "google_storage_bucket" "audio_chunks" {
  name          = "${var.bucket_name_prefix}-${var.environment}-${var.project_id}"
  location      = var.region
  project       = var.project_id
  storage_class = "STANDARD"

  # Prevent accidental public exposure of meeting recordings
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Backstop only (ARCHITECTURE §11.6): the retention job deletes per the user's choice (D-02:
  # immediately, 7 days by default, or 30 days); this rule catches what a failed job leaves behind.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = var.retention_days
    }
  }

  # Signed PUT uploads of video fragments come from the extension's offscreen document, so only
  # the extension origin is allowed, never the Meet page (ADR-0011 §3.3). Empty list = no CORS.
  dynamic "cors" {
    for_each = length(var.upload_origins) > 0 ? [1] : []
    content {
      origin          = var.upload_origins
      method          = ["PUT"]
      # The signed size range travels as x-goog-content-length-range (S2-14,
      # @meetyou/storage signFragmentUploads); the browser may only send it if CORS lists it.
      response_header = ["Content-Type", "x-goog-content-length-range"]
      max_age_seconds = 3600
    }
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "meetyou"
  }
}

