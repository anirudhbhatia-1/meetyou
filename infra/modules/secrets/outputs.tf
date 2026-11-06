output "deepgram_secret_id" {
  description = "Secret Manager ID for Deepgram API key."
  value       = google_secret_manager_secret.deepgram_api_key.secret_id
}

output "auth_signing_jwks_secret_id" {
  description = "Secret Manager ID for auth signing JWKS."
  value       = google_secret_manager_secret.auth_signing_jwks.secret_id
}

output "db_password_secret_id" {
  description = "Secret Manager ID for PostgreSQL user password."
  value       = google_secret_manager_secret.database_password.secret_id
}

output "database_url_secret_id" {
  description = "Secret Manager ID for database connection URL."
  value       = google_secret_manager_secret.database_url.secret_id
}

output "google_oauth_client_secret_id" {
  description = "Secret Manager ID for Google OAuth client secret."
  value       = google_secret_manager_secret.google_oauth_client_secret.secret_id
}
