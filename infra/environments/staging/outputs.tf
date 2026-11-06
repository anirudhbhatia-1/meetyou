output "gateway_url" {
  description = "The public HTTPS/WSS URL of the Cloud Run Realtime Gateway."
  value       = module.cloud_run.service_url
}

output "api_url" {
  description = "The public HTTPS URL of the Cloud Run REST API."
  value       = module.cloud_run.api_url
}

output "audio_bucket_name" {
  description = "The Cloud Storage bucket for 7-day retention audio chunks and video fragments."
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

output "api_service_account" {
  description = "Runtime service account for the REST API container."
  value       = module.cloud_run.api_sa_email
}

output "worker_service_account" {
  description = "Runtime service account for the background worker container."
  value       = module.cloud_run.worker_sa_email
}

output "migrate_service_account" {
  description = "Runtime service account for the database migration job."
  value       = module.cloud_run.migrate_sa_email
}

output "migrate_job_name" {
  description = "Name of the Cloud Run migration job."
  value       = module.cloud_run.migrate_job_name
}

output "artifact_registry_repo" {
  description = "Artifact Registry Docker repository URL for images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.name}"
}

output "redis_host" {
  description = "Private IP address of the Memorystore Redis instance."
  value       = google_redis_instance.session_redis.host
}
