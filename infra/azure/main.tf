locals {
  prefix = "meetyou-${var.environment}"
  # Globally unique names allow only lowercase letters and digits (registry, storage account).
  compact = "meetyou${var.environment}${var.unique_suffix}"
  tags = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "meetyou"
  }
  extension_origin = "chrome-extension://${var.extension_id}"
}

resource "azurerm_resource_group" "main" {
  name     = "${local.prefix}-rg"
  location = var.location
  tags     = local.tags
}

resource "azurerm_container_registry" "main" {
  name                = local.compact
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

# One runtime identity for the apps and jobs on staging (ADR-0012 §2). It pulls images, reads
# Key Vault secrets and reads/writes recordings (signing SAS with a user delegation key).
resource "azurerm_user_assigned_identity" "runtime" {
  name                = "${local.prefix}-runtime"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_role_assignment" "runtime_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.runtime.principal_id
  principal_type       = "ServicePrincipal"
}

# --- Key Vault -------------------------------------------------------------------------------
# Secrets the apps read by reference. Terraform writes only the two it can build (database and
# Redis URLs); the rest are set by hand with `az keyvault secret set` (runbook A.4) so their
# values never enter Terraform state.
resource "azurerm_key_vault" "main" {
  name                       = "meetyou-${substr(var.environment, 0, 3)}-${var.unique_suffix}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
  tags                       = local.tags
}

resource "azurerm_role_assignment" "runtime_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.runtime.principal_id
  principal_type       = "ServicePrincipal"
}

# Whoever runs Terraform (Anirudh) writes the generated secrets and sets the manual ones.
resource "azurerm_role_assignment" "operator_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

locals {
  # Names in Key Vault, and the Container Apps secret names that reference them.
  manual_secrets = ["deepgram-api-key", "gemini-api-key", "auth-signing-jwks", "google-client-secret"]
  kv_secret_url  = { for name in concat(local.manual_secrets, ["database-url", "redis-url"]) : name => "${azurerm_key_vault.main.vault_uri}secrets/${name}" }
}

resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  key_vault_id = azurerm_key_vault.main.id
  # Supavisor session mode: the user is <role>.<project ref>. sslmode=no-verify keeps TLS on but
  # skips chain checks: Supabase signs with its own CA, which is not in Node's store [Verify].
  value      = "postgres://${var.database_user}:${urlencode(var.db_app_password)}@${var.database_host}:5432/${var.database_name}?sslmode=no-verify"
  depends_on = [azurerm_role_assignment.operator_kv_secrets]
}

resource "azurerm_key_vault_secret" "redis_url" {
  name         = "redis-url"
  key_vault_id = azurerm_key_vault.main.id
  # rediss:// turns on TLS in ioredis; Managed Redis takes the access key as the password.
  value      = "rediss://:${urlencode(azurerm_managed_redis.main.default_database[0].primary_access_key)}@${azurerm_managed_redis.main.hostname}:${azurerm_managed_redis.main.default_database[0].port}"
  depends_on = [azurerm_role_assignment.operator_kv_secrets]
}

# --- Recordings storage ----------------------------------------------------------------------
resource "azurerm_storage_account" "recordings" {
  name                     = local.compact
  location                 = azurerm_resource_group.main.location
  resource_group_name      = azurerm_resource_group.main.name
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  min_tls_version          = "TLS1_2"

  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  # Every link is a user delegation SAS signed with Entra ID; no account key is ever used.
  shared_access_key_enabled = false

  blob_properties {
    # Video fragments are PUT from the extension's offscreen document (ADR-0011 §3.3); the web
    # player reads playback.mp4. Soft delete stays off so a deletion is final (PRD PRV-06).
    cors_rule {
      allowed_origins    = [local.extension_origin]
      allowed_methods    = ["PUT"]
      allowed_headers    = ["content-type", "x-ms-blob-type"]
      exposed_headers    = ["etag"]
      max_age_in_seconds = 3600
    }
    cors_rule {
      allowed_origins    = ["https://${local.fqdn.web}"]
      allowed_methods    = ["GET", "HEAD"]
      allowed_headers    = ["range"]
      exposed_headers    = ["content-length", "content-range", "accept-ranges"]
      max_age_in_seconds = 3600
    }
  }

  tags = local.tags
}

resource "azurerm_storage_container" "recordings" {
  name                  = "recordings"
  storage_account_id    = azurerm_storage_account.recordings.id
  container_access_type = "private"
  # Created through Entra ID, so the operator's data role must exist first.
  depends_on = [azurerm_role_assignment.operator_blob]
}

# Reads, writes, deletes and getUserDelegationKey (needed to sign SAS links).
resource "azurerm_role_assignment" "runtime_blob" {
  scope                = azurerm_storage_account.recordings.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.runtime.principal_id
  principal_type       = "ServicePrincipal"
}

# Terraform itself manages the container and policy through Entra ID (storage_use_azuread).
resource "azurerm_role_assignment" "operator_blob" {
  scope                = azurerm_storage_account.recordings.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Backstop only (ARCHITECTURE §11.6), as the GCS lifecycle rule was: the retention job deletes per
# the user's choice; this catches what a failed job leaves behind. Keys start with ws/ (layout.ts).
resource "azurerm_storage_management_policy" "recordings" {
  storage_account_id = azurerm_storage_account.recordings.id

  rule {
    name    = "recordings-backstop"
    enabled = true
    filters {
      prefix_match = ["${azurerm_storage_container.recordings.name}/ws/"]
      blob_types   = ["blockBlob"]
    }
    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = var.storage_retention_days
      }
    }
  }
}
