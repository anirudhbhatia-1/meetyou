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

variable "extension_origins" {
  description = "Extension origin(s) allowed to upload video fragments, e.g. [\"chrome-extension://<id>\"]. An unpacked build's ID depends on its folder unless the manifest has a `key`."
  type        = list(string)
  default     = []
}

variable "gateway_image" {
  description = "Docker image for the gateway Cloud Run service."
  type        = string
  default     = "gcr.io/google-samples/hello-app:1.0"
}

