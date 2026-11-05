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
  description = "Number of days before raw audio chunks are automatically deleted (D-02 defaults to 7 days)."
  type        = number
  default     = 7
}

