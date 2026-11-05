output "service_url" {
  description = "The public URL of the Cloud Run Realtime Gateway service."
  value       = google_cloud_run_v2_service.gateway.uri
}

output "service_account_email" {
  description = "The email address of the gateway runtime service account."
  value       = google_service_account.gateway_sa.email
}

