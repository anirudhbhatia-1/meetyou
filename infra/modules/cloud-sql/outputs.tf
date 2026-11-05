output "instance_name" {
  description = "The name of the Cloud SQL instance."
  value       = google_sql_database_instance.postgres.name
}

output "connection_name" {
  description = "The connection name of the Cloud SQL instance (project:region:instance)."
  value       = google_sql_database_instance.postgres.connection_name
}

output "private_ip_address" {
  description = "The private IPv4 address assigned to Cloud SQL."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "database_name" {
  description = "The primary PostgreSQL database name."
  value       = google_sql_database.app_db.name
}

output "database_user" {
  description = "The primary PostgreSQL user name."
  value       = google_sql_user.app_user.name
}

