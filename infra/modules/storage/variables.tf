variable "project_id" {
  description = "The Google Cloud Project ID."
  type        = string
}

variable "region" {
  description = "Google Cloud region for regional storage (ADR-0002 Mumbai)."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Deployment environment name (e.g. staging, prod)."
  type        = string
  default     = "staging"
}

variable "bucket_name_prefix" {
  description = "Prefix for the audio chunks storage bucket."
  type        = string
  default     = "meetyou-audio-chunks"
}

variable "retention_days" {
  description = "Lifecycle backstop in days. Must exceed the longest user retention choice (30 days, D-02); the retention job does the real deletion (ARCHITECTURE §11.6)."
  type        = number
  default     = 31

  validation {
    condition     = var.retention_days > 30
    error_message = "retention_days must exceed 30 so the backstop never deletes recordings a user chose to keep for 30 days (D-02)."
  }
}

variable "upload_origins" {
  description = "Origins allowed to PUT signed video fragment URLs: the extension origin(s), e.g. chrome-extension://<id> (ADR-0011 §3.3)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for o in var.upload_origins : startswith(o, "chrome-extension://")])
    error_message = "upload_origins must be chrome-extension:// origins only; the Meet page must never be allowed."
  }
}

