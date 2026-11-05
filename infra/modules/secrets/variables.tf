variable "project_id" {
  description = "The Google Cloud Project ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name (e.g. staging, prod)."
  type        = string
  default     = "staging"
}

variable "service_account_email" {
  description = "The email of the Cloud Run runtime service account to grant secret access."
  type        = string
}

