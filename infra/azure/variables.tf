variable "subscription_id" {
  description = "Azure subscription ID (az account show --query id -o tsv)."
  type        = string
}

variable "location" {
  description = "Azure region. Central India (Pune), Anirudh 2026-11-12."
  type        = string
  default     = "centralindia"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "unique_suffix" {
  description = "Lowercase letters/digits (4-8) that make global names unique: registry, storage account, Key Vault, Postgres server."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]{4,8}$", var.unique_suffix))
    error_message = "unique_suffix must be 4-8 lowercase letters or digits."
  }
}

variable "extension_id" {
  description = "Chrome extension ID, fixed by the manifest key."
  type        = string
  default     = "hjimcofnjnikbeepahmclaniopbnhbbe"
}

variable "github_repository" {
  description = "owner/name of the repository whose main branch may deploy."
  type        = string
  default     = "anirudhbhatia-1/meetyou"
}

variable "github_oidc_subject" {
  description = "Exact sub claim of the deploy job's OIDC token. This repository's tokens carry the owner and repository IDs (seen in the 2026-11-13 login error)."
  type        = string
  default     = "repo:anirudhbhatia-1@256722165/meetyou@1436821180:environment:staging"
}

variable "db_app_password" {
  description = "Password of the meetyou_app role the services connect as (>= 32 random characters)."
  type        = string
  sensitive   = true
}

variable "image_tag" {
  description = "Image tag the apps are created with (a commit SHA pushed by the deploy workflow). Later deploys change images outside Terraform."
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth web client ID (public)."
  type        = string
}

variable "stream_token_jwks" {
  description = "PUBLIC JWKS JSON the gateway verifies stream tokens with (runbook A.5). Never the private keys."
  type        = string
}

variable "gemini_free_tier" {
  description = "true only while staging uses the free Gemini key for agreed test meetings (AGENTS §9, 2026-11-07)."
  type        = bool
  default     = true
}

variable "storage_retention_days" {
  description = "Backstop: blobs under ws/ are deleted this many days after creation (the retention job deletes earlier, D-02)."
  type        = number
  default     = 31
}

variable "database_host" {
  description = "Supavisor host of the Supabase project, e.g. aws-0-ap-south-1.pooler.supabase.com (Connect → Session pooler)."
  type        = string
}

variable "database_user" {
  description = "Pooler user: meetyou_app.<project ref>."
  type        = string
}

variable "database_name" {
  type    = string
  default = "postgres"
}

variable "container_app_environment_name" {
  description = "Existing Container Apps environment the apps and jobs run in (one per region on this subscription)."
  type        = string
  default     = "cae-neighbourhood-test"
}

variable "container_app_environment_resource_group" {
  type    = string
  default = "rg-neighbourhood-test"
}
