terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # For initial bootstrap, state is local.
  # Once bucket is created, uncomment the GCS backend below:
  # backend "gcs" {
  #   bucket = "meetyou-staging-tfstate"
  #   prefix = "terraform/state/staging"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 1. Enable required Google Cloud APIs for Stage 1 & Stage 2
locals {
  services = [
    "cloudresourcemanager.googleapis.com", # Master Resource Manager API
    "iam.googleapis.com",              # Identity and Access Management for service accounts
    "run.googleapis.com",              # Cloud Run for Gateway & API
    "sqladmin.googleapis.com",         # Cloud SQL for PostgreSQL 16
    "storage.googleapis.com",          # Cloud Storage for audio/video chunks
    "speech.googleapis.com",           # Speech-to-Text V2 for Chirp 3 (ADR-0001)
    "secretmanager.googleapis.com",    # Secret Manager for keys & tokens
    "vpcaccess.googleapis.com",        # Serverless VPC Access connector
    "servicenetworking.googleapis.com",# Private service networking for Cloud SQL
    "compute.googleapis.com",          # Compute Engine API for VPC networks
  ]
}

resource "google_project_service" "enabled_services" {
  for_each                   = toset(local.services)
  project                    = var.project_id
  service                    = each.key
  disable_on_destroy         = false
  disable_dependent_services = false
}

# 2. Audio & Video Chunks Storage (7-day automated retention lifecycle)
module "storage" {
  source     = "../../modules/storage"
  project_id = var.project_id
  region     = var.region
  environment = "staging"

  depends_on = [google_project_service.enabled_services]
}

# 3. VPC Network & Serverless Connector for Private IP
module "vpc" {
  source     = "../../modules/vpc"
  project_id = var.project_id
  region     = var.region
  environment = "staging"

  depends_on = [google_project_service.enabled_services]
}

# 4. Cloud Run Realtime Gateway (60-minute WebSocket session timeout)
module "cloud_run" {
  source            = "../../modules/cloud-run"
  project_id        = var.project_id
  region            = var.region
  environment       = "staging"
  gateway_image     = var.gateway_image
  vpc_connector_id  = module.vpc.vpc_connector_id
  audio_bucket_name = module.storage.bucket_name

  depends_on = [google_project_service.enabled_services]
}

# 5. Secrets Container and IAM Access
module "secrets" {
  source                = "../../modules/secrets"
  project_id            = var.project_id
  environment           = "staging"
  service_account_email = module.cloud_run.service_account_email

  depends_on = [google_project_service.enabled_services]
}

# 6. Cloud SQL for PostgreSQL 16 (Private IP inside VPC)
module "cloud_sql" {
  source                 = "../../modules/cloud-sql"
  project_id             = var.project_id
  region                 = var.region
  environment            = "staging"
  private_network_id     = module.vpc.network_id
  db_password            = var.db_password
  vpc_peering_dependency = module.vpc.private_vpc_connection

  depends_on = [google_project_service.enabled_services]
}

# 7. Grant Gateway Service Account Object Access to Audio Bucket
resource "google_storage_bucket_iam_member" "gateway_audio_writer" {
  bucket = module.storage.bucket_name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${module.cloud_run.service_account_email}"
}

