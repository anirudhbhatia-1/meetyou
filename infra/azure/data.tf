# --- Postgres -------------------------------------------------------------------------------
# Supabase, Mumbai (ap-south-1), free plan (Anirudh, 2026-11-13). The Azure for Students
# subscription cannot create Postgres Flexible Servers (SkuNotAvailable in every allowed region)
# or small VMs (ADR-0012 §2.3). The services reach it through Supavisor in session mode (port 5432,
# IPv4, one server session per client, so LISTEN/NOTIFY and advisory locks work) as meetyou_app.

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
