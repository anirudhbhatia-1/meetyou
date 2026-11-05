output "gateway_url" {
  description = "The public HTTPS/WSS URL of the Cloud Run Realtime Gateway."
  value       = module.cloud_run.service_url
}

output "audio_bucket_name" {
  description = "The Cloud Storage bucket for 7-day retention audio chunks."
  value       = module.storage.bucket_name
}

output "db_connection_name" {
  description = "Cloud SQL instance connection name for Cloud Run proxy or migrations."
  value       = module.cloud_sql.connection_name
}

output "db_private_ip" {
  description = "Private IP address of the PostgreSQL 16 database."
  value       = module.cloud_sql.private_ip_address
}

output "gateway_service_account" {
  description = "Runtime service account for the gateway container."
  value       = module.cloud_run.service_account_email
}

