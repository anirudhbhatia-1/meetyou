resource "google_secret_manager_secret" "deepgram_api_key" {
  secret_id = "meetyou-${var.environment}-deepgram-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "meetyou"
  }
}

resource "google_secret_manager_secret" "jwt_signing_key" {
  secret_id = "meetyou-${var.environment}-jwt-signing-key"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "meetyou"
  }
}

resource "google_secret_manager_secret" "database_password" {
  secret_id = "meetyou-${var.environment}-db-password"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "meetyou"
  }
}

# Grant Cloud Run service account access to read secrets at runtime
resource "google_secret_manager_secret_iam_member" "deepgram_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.deepgram_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account_email}"
}

resource "google_secret_manager_secret_iam_member" "jwt_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.jwt_signing_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account_email}"
}

resource "google_secret_manager_secret_iam_member" "db_password_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account_email}"
}

