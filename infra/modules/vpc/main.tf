resource "google_compute_network" "vpc_network" {
  name                    = "meetyou-${var.environment}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "meetyou-${var.environment}-subnet"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.vpc_network.id
  ip_cidr_range = var.subnet_cidr
}

# Reserve internal IP range for Cloud SQL Private Services Access
resource "google_compute_global_address" "private_ip_alloc" {
  name          = "meetyou-${var.environment}-sql-ip"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc_network.id
}

# Peering connection between our VPC and Google's managed services network (Cloud SQL)
resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc_network.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
}

# Serverless VPC Access connector allowing Cloud Run to reach private IP Cloud SQL & Redis
resource "google_vpc_access_connector" "serverless_connector" {
  name          = "meetyou-${var.environment}-vpc-con"
  project       = var.project_id
  region        = var.region
  ip_cidr_range = var.connector_cidr
  network       = google_compute_network.vpc_network.name

  # Min/Max instances for low-cost staging
  min_instances = 2
  max_instances = 3
  machine_type  = "e2-micro"
}

