# Manual jobs the deploy workflow starts: migrate before the apps roll, smoke after
# (az containerapp job start). Same identity, registry and Key Vault references as the apps.
locals {
  jobs = {
    migrate = {
      env     = { APP_ENV = var.environment, PG_POOL_MAX = "2" }
      secrets = { DATABASE_URL = "database-url" }
      timeout = 600
    }
    smoke = {
      env = {
        APP_ENV      = var.environment
        PG_POOL_MAX  = "2"
        API_URL      = "https://${local.fqdn.api}"
        SMOKE_ORIGIN = local.extension_origin
      }
      secrets = { DATABASE_URL = "database-url", AUTH_SIGNING_JWKS = "auth-signing-jwks" }
      timeout = 900
    }
  }
}

resource "azurerm_container_app_job" "job" {
  for_each = local.jobs

  name                         = "${local.prefix}-${each.key}"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = data.azurerm_container_app_environment.main.id
  replica_timeout_in_seconds   = each.value.timeout
  replica_retry_limit          = 0 # a failed migration or smoke run must fail the deploy, not retry

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.runtime.id]
  }

  registry {
    server   = local.registry
    identity = azurerm_user_assigned_identity.runtime.id
  }

  dynamic "secret" {
    for_each = toset(values(each.value.secrets))
    content {
      name                = secret.value
      key_vault_secret_id = local.kv_secret_url[secret.value]
      identity            = azurerm_user_assigned_identity.runtime.id
    }
  }

  template {
    container {
      name   = each.key
      image  = "${local.registry}/${each.key}:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      dynamic "env" {
        for_each = each.value.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = each.value.secrets
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [
    azurerm_role_assignment.runtime_acr_pull,
    azurerm_role_assignment.runtime_kv_secrets,
    azurerm_key_vault_secret.database_url,
  ]

  tags = local.tags
}
