# --- Postgres -------------------------------------------------------------------------------
# B1ms is in the free account's 12-month offer (750 h/month, 32 GB). About 50 connections, so
# every service runs PG_POOL_MAX=4 (ADR-0012 §2.2.5). The admin login only creates meetyou_app
# (runbook A.3); the services and migrations connect as meetyou_app, which owns the tables.
resource "azurerm_postgresql_flexible_server" "main" {
  name                = "${local.prefix}-pg-${var.unique_suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  version             = "16"
  sku_name            = "B_Standard_B1ms"
  storage_mb          = 32768

  administrator_login    = "meetyou_admin"
  administrator_password = var.db_admin_password

  # PRD PRV-06: deleted data leaves backups within 30 days.
  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  # Staging uses the public endpoint with TLS and the Azure-services rule below; Consumption
  # Container Apps have no fixed outbound IP. Production needs a VNet (ADR-0012 §2.2.6).
  public_network_access_enabled = true

  lifecycle {
    # Azure picks a zone on create; changing it later would try to move the server.
    ignore_changes = [zone]
  }

  tags = local.tags
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "meetyou"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# 0.0.0.0–0.0.0.0 is Azure's "allow access from Azure services" rule.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# --- Redis (gateway session registry) -------------------------------------------------------
# Azure Managed Redis: Azure Cache for Redis takes no new customers from 2026-04-01. NoCluster
# because the gateway uses a plain ioredis client, not a cluster client. NoEviction so live
# session keys are never dropped under memory pressure; they carry their own TTLs.
resource "azurerm_managed_redis" "main" {
  name                      = "${local.prefix}-redis-${var.unique_suffix}"
  resource_group_name       = azurerm_resource_group.main.name
  location                  = azurerm_resource_group.main.location
  sku_name                  = "Balanced_B0"
  high_availability_enabled = false # staging; a restart only makes clients reconnect

  default_database {
    access_keys_authentication_enabled = true
    client_protocol                    = "Encrypted"
    clustering_policy                  = "NoCluster"
    eviction_policy                    = "NoEviction"
  }

  tags = local.tags
}
