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

variable "database_version" {
  description = "PostgreSQL version (ADR-0002 requires Postgres 13+ for pgvector; default Postgres 16)."
  type        = string
  default     = "POSTGRES_16"
}

variable "tier" {
  description = "Machine type for the Cloud SQL instance."
  type        = string
  default     = "db-custom-1-3840"
}

variable "private_network_id" {
  description = "VPC network ID to attach Cloud SQL via Private IP."
  type        = string
}

variable "db_password" {
  description = "PostgreSQL user password."
  type        = string
  sensitive   = true
}

variable "vpc_peering_dependency" {
  description = "Explicit dependency on the VPC service networking connection."
  type        = any
}

