terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # For initial bootstrap, state is local.
  # Once bucket is created, uncomment the GCS backend below (STAGING_SETUP §3):
  # backend "gcs" {
  #   bucket = "meetyou-staging-tfstate-project-7ddc1bbe-aea4-44f7-bd0"
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
    "iam.googleapis.com",                  # Identity and Access Management for service accounts
    "run.googleapis.com",                  # Cloud Run for Gateway, API, Worker & Jobs
    "sqladmin.googleapis.com",             # Cloud SQL for PostgreSQL 16
    "storage.googleapis.com",              # Cloud Storage for audio/video chunks
    "secretmanager.googleapis.com",        # Secret Manager for keys & tokens
    "vpcaccess.googleapis.com",            # Serverless VPC Access connector
    "servicenetworking.googleapis.com",    # Private service networking for Cloud SQL & Redis
    "compute.googleapis.com",              # Compute Engine API for VPC networks
    "artifactregistry.googleapis.com",     # Artifact Registry for container images
    "redis.googleapis.com",                # Memorystore for Redis (Gateway sessions)
    "logging.googleapis.com",              # Log-based metrics (S2-11)
    "monitoring.googleapis.com",           # Alert policies and dashboards (S2-11)
    "iamcredentials.googleapis.com",       # signBlob for V4 signed URLs on Cloud Run (S2-14)
    "sts.googleapis.com",                  # Workload Identity Federation for GitHub Actions (S2-12)
    "telemetry.googleapis.com",            # OTLP trace ingestion for Cloud Trace (S2-11)
  ]
}

resource "google_project_service" "enabled_services" {
  for_each                   = toset(local.services)
  project                    = var.project_id
  service                    = each.key
  disable_on_destroy         = false
  disable_dependent_services = false
}

# 2. Audio & Video Chunks Storage (31-day lifecycle backstop; the retention job deletes per D-02)
module "storage" {
  source         = "../../modules/storage"
  project_id     = var.project_id
  region         = var.region
  environment    = "staging"
  upload_origins = var.extension_origins

  depends_on = [google_project_service.enabled_services]
}

# 3. VPC Network & Serverless Connector for Private IP
module "vpc" {
  source      = "../../modules/vpc"
  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  depends_on = [google_project_service.enabled_services]
}

# 4. Cloud Run Services & Jobs (Gateway, REST API, Background Worker, Migration Job)
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

# 5. Secrets Container and Per-Service Accessor IAM Roles (STAGING_SETUP §5.2, §7)
module "secrets" {
  source           = "../../modules/secrets"
  project_id       = var.project_id
  environment      = "staging"
  gateway_sa_email = module.cloud_run.service_account_email
  api_sa_email     = module.cloud_run.api_sa_email
  worker_sa_email  = module.cloud_run.worker_sa_email
  migrate_sa_email = module.cloud_run.migrate_sa_email

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

# 7. Artifact Registry Docker Repository for container images (STAGING_SETUP §5.2)
resource "google_artifact_registry_repository" "docker_repo" {
  project       = var.project_id
  location      = var.region
  repository_id = "meetyou"
  description   = "MeetYou Docker container images"
  format        = "DOCKER"

  depends_on = [google_project_service.enabled_services]
}

# 8. Memorystore for Redis for Gateway Session State (S2-04, STAGING_SETUP §5.2)
resource "google_redis_instance" "session_redis" {
  name           = "meetyou-staging-redis"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region
  project        = var.project_id

  authorized_network = module.vpc.network_id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  depends_on = [
    google_project_service.enabled_services,
    module.vpc.private_vpc_connection
  ]
}

# Observability (S2-11): log-based metrics, alerts and the dashboard. Safe to apply on its own:
#   terraform apply -target=module.monitoring
module "monitoring" {
  source       = "../../modules/monitoring"
  project_id   = var.project_id
  environment  = "staging"
  alert_emails = var.alert_emails

  depends_on = [google_project_service.enabled_services]
}

# Tracing (S2-11): API, gateway and worker export OTLP spans to the Telemetry API with their own
# service accounts. Emails are spelled out (not read from module.cloud_run) so a targeted apply
# never pulls the Cloud Run services into the plan:
#   terraform apply -target=google_project_iam_member.telemetry
resource "google_project_iam_member" "telemetry" {
  for_each = {
    for pair in setproduct(["api", "gateway", "worker"], [
      "roles/telemetry.tracesWriter",
      "roles/serviceusage.serviceUsageConsumer",
    ]) : "${pair[0]}:${pair[1]}" => { sa = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:meetyou-staging-${each.value.sa}-sa@${var.project_id}.iam.gserviceaccount.com"

  depends_on = [google_project_service.enabled_services]
}

# CI/CD identity (S2-12): GitHub Actions deploys keylessly. Apply on its own:
#   terraform apply -target=module.ci
module "ci" {
  source      = "../../modules/ci"
  project_id  = var.project_id
  environment = "staging"

  depends_on = [google_project_service.enabled_services]
}
