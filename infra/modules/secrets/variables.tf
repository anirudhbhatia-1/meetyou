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
  description = "The email of the Cloud Run gateway runtime service account (legacy fallback)."
  type        = string
  default     = ""
}

variable "gateway_sa_email" {
  description = "Service account email for the Realtime Gateway."
  type        = string
  default     = ""
}

variable "api_sa_email" {
  description = "Service account email for the REST API."
  type        = string
  default     = ""
}

variable "worker_sa_email" {
  description = "Service account email for the Background Worker."
  type        = string
  default     = ""
}

variable "migrate_sa_email" {
  description = "Service account email for the Migration Job."
  type        = string
  default     = ""
}
