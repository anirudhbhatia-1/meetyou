variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Environment name; services are named meetyou-<environment>-<service>."
  type        = string
}

variable "alert_emails" {
  description = "Addresses that receive alert notifications. Empty: alerts are created without channels (visible in the console only)."
  type        = list(string)
  default     = []
}
