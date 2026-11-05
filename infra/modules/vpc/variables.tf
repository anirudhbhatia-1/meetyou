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

variable "subnet_cidr" {
  description = "CIDR range for the staging VPC subnet."
  type        = string
  default     = "10.10.0.0/24"
}

variable "connector_cidr" {
  description = "CIDR range (/28) for the Serverless VPC Access connector."
  type        = string
  default     = "10.10.8.0/28"
}

