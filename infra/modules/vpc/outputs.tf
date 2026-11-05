output "network_id" {
  description = "The ID of the VPC network."
  value       = google_compute_network.vpc_network.id
}

output "network_name" {
  description = "The name of the VPC network."
  value       = google_compute_network.vpc_network.name
}

output "subnet_id" {
  description = "The ID of the subnetwork."
  value       = google_compute_subnetwork.subnet.id
}

output "vpc_connector_id" {
  description = "The ID of the Serverless VPC Access connector for Cloud Run."
  value       = google_vpc_access_connector.serverless_connector.id
}

output "private_vpc_connection" {
  description = "The private VPC service networking connection resource."
  value       = google_service_networking_connection.private_vpc_connection
}

