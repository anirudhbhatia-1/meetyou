variable "project_id" {
  description = "The Google Cloud Project ID for the staging environment."
  type        = string
}

variable "region" {
  description = "Google Cloud region (ADR-0002 Mumbai)."
  type        = string
  default     = "asia-south1"
}

variable "db_password" {
  description = "Initial password for the Cloud SQL PostgreSQL app user."
  type        = string
  sensitive   = true
}

variable "gateway_image" {
  description = "Docker image for the gateway Cloud Run service."
  type        = string
  default     = "gcr.io/google-samples/hello-app:1.0"
}

