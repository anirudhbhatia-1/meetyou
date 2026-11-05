variable "project_id" {
  description = "The Google Cloud Project ID."
  type        = string
}

variable "region" {
  description = "Google Cloud region (ADR-0002 Mumbai)."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Deployment environment name (e.g. staging, prod)."
  type        = string
  default     = "staging"
}

variable "gateway_image" {
  description = "Container image URL for the realtime gateway service."
  type        = string
  default     = "gcr.io/google-samples/hello-app:1.0" # Placeholder until first CI container build
}

variable "vpc_connector_id" {
  description = "VPC connector ID for private networking."
  type        = string
}

variable "audio_bucket_name" {
  description = "Name of the GCS bucket for audio chunks."
  type        = string
}

