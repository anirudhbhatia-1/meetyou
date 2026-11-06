output "workload_identity_provider" {
  description = "Repository variable GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Repository variable GCP_DEPLOY_SA."
  value       = google_service_account.deployer.email
}
