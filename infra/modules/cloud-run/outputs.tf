output "service_url" {
  description = "The public URL of the Cloud Run Realtime Gateway service."
  value       = google_cloud_run_v2_service.gateway.uri
}

output "service_account_email" {
  description = "The email address of the gateway runtime service account."
  value       = google_service_account.gateway_sa.email
}

output "api_url" {
  description = "The public URL of the Cloud Run REST API service."
  value       = google_cloud_run_v2_service.api.uri
}

output "api_sa_email" {
  description = "The email address of the API service account."
  value       = google_service_account.api_sa.email
}

output "worker_sa_email" {
  description = "The email address of the Background Worker service account."
  value       = google_service_account.worker_sa.email
}

output "migrate_sa_email" {
  description = "The email address of the Migration Job service account."
  value       = google_service_account.migrate_sa.email
}

output "migrate_job_name" {
  description = "The name of the Cloud Run database migration job."
  value       = google_cloud_run_v2_job.migrate.name
}
