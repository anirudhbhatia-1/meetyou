variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Environment name (staging)."
  type        = string
}

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy."
  type        = string
  default     = "anirudhbhatia-1/meetyou"
}

variable "deploy_ref" {
  description = "Only workflows running on this ref may deploy."
  type        = string
  default     = "refs/heads/main"
}
