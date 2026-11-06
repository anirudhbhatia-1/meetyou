locals {
  effective_gateway_sa = var.gateway_sa_email != "" ? var.gateway_sa_email : var.service_account_email
}

# 1. Deepgram API Key (Gateway only)
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

resource "google_secret_manager_secret_iam_member" "deepgram_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.deepgram_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.effective_gateway_sa}"
}

# 2. Database Password (Reference only)
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

# 3. Full Database Connection URL (Gateway, API, Worker, Migrate Job)
resource "google_secret_manager_secret" "database_url" {
  secret_id = "meetyou-${var.environment}-database-url"
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

resource "google_secret_manager_secret_iam_member" "db_url_gateway" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.effective_gateway_sa}"
}

resource "google_secret_manager_secret_iam_member" "db_url_api" {
  count     = var.api_sa_email != "" ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.api_sa_email}"
}

resource "google_secret_manager_secret_iam_member" "db_url_worker" {
  count     = var.worker_sa_email != "" ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.worker_sa_email}"
}

resource "google_secret_manager_secret_iam_member" "db_url_migrate" {
  count     = var.migrate_sa_email != "" ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.migrate_sa_email}"
}

# 4. Auth Signing Private JWKS JSON array (API only, ADR-0004 §4.2)
resource "google_secret_manager_secret" "auth_signing_jwks" {
  secret_id = "meetyou-${var.environment}-auth-signing-jwks"
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

resource "google_secret_manager_secret_iam_member" "auth_signing_jwks_api" {
  count     = var.api_sa_email != "" ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.auth_signing_jwks.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.api_sa_email}"
}

# 5. Google OAuth Client Secret (API only, ADR-0004 §4.1)
resource "google_secret_manager_secret" "google_oauth_client_secret" {
  secret_id = "meetyou-${var.environment}-google-oauth-client-secret"
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

resource "google_secret_manager_secret_iam_member" "google_oauth_secret_api" {
  count     = var.api_sa_email != "" ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.google_oauth_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.api_sa_email}"
}
