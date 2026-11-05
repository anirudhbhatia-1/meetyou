output "deepgram_secret_id" {
  description = "Secret Manager ID for Deepgram API key."
  value       = google_secret_manager_secret.deepgram_api_key.secret_id
}

output "jwt_signing_key_secret_id" {
  description = "Secret Manager ID for JWT signing key."
  value       = google_secret_manager_secret.jwt_signing_key.secret_id
}

output "db_password_secret_id" {
  description = "Secret Manager ID for PostgreSQL user password."
  value       = google_secret_manager_secret.database_password.secret_id
}

