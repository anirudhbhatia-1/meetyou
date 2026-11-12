resource "azurerm_container_app_environment" "main" {
  name                       = "${local.prefix}-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags
}

locals {
  registry = azurerm_container_registry.main.login_server
  # An app's public host is <name>.<environment default domain>, known before the app exists.
  # That breaks the API ⇄ web cycle (each needs the other's URL).
  app_name = {
    api     = "${local.prefix}-api"
    gateway = "${local.prefix}-gateway"
    web     = "${local.prefix}-web"
    worker  = "${local.prefix}-worker"
  }
  fqdn = { for k, v in local.app_name : k => "${v}.${azurerm_container_app_environment.main.default_domain}" }

  gemini_env = {
    LLM_PROVIDER              = "gemini"
    GEMINI_FREE_TIER_ACCEPTED = tostring(var.gemini_free_tier)
  }
  gemini_staging_env = var.gemini_free_tier ? { GEMINI_FREE_TIER_ON_STAGING = "true" } : {}

  # Every backend process: environment, listener, managed identity and recordings.
  common_env = {
    APP_ENV                 = var.environment
    PORT                    = "8080"
    HOST                    = "0.0.0.0"
    PG_POOL_MAX             = "4"
    AZURE_CLIENT_ID         = azurerm_user_assigned_identity.runtime.client_id
    AZURE_STORAGE_ACCOUNT   = azurerm_storage_account.recordings.name
    AZURE_STORAGE_CONTAINER = azurerm_storage_container.recordings.name
  }

  # env name => Key Vault secret name, per app.
  app_secrets = {
    api     = { DATABASE_URL = "database-url", AUTH_SIGNING_JWKS = "auth-signing-jwks", GOOGLE_CLIENT_SECRET = "google-client-secret", GEMINI_API_KEY = "gemini-api-key" }
    gateway = { DATABASE_URL = "database-url", REDIS_URL = "redis-url", DEEPGRAM_API_KEY = "deepgram-api-key" }
    worker  = { DATABASE_URL = "database-url", DEEPGRAM_API_KEY = "deepgram-api-key", GEMINI_API_KEY = "gemini-api-key" }
  }

  app_env = {
    api = merge(local.common_env, local.gemini_env, local.gemini_staging_env, {
      GOOGLE_CLIENT_ID      = var.google_client_id
      ALLOWED_REDIRECT_URIS = "https://${var.extension_id}.chromiumapp.org/oauth2,https://${local.fqdn.web}/auth/callback"
      GATEWAY_WS_URL        = "wss://${local.fqdn.gateway}/v1/stream"
    })
    gateway = merge(local.common_env, {
      STT_PROVIDER      = "deepgram"
      STREAM_TOKEN_JWKS = var.stream_token_jwks
      ALLOWED_ORIGINS   = local.extension_origin
      DISPLAY_TEXT      = "as_provided"
    })
    worker = merge(local.common_env, local.gemini_env, local.gemini_staging_env, {
      STT_PROVIDER        = "deepgram"
      BATCH_TRANSCRIPTION = "on"
    })
  }

  # Consumption plan CPU/memory pairs. The worker runs ffmpeg (video.finalize).
  app_size = {
    api     = { cpu = 0.5, memory = "1Gi", min = 0, max = 2 }
    gateway = { cpu = 0.5, memory = "1Gi", min = 0, max = 2 }
    worker  = { cpu = 1.0, memory = "2Gi", min = 1, max = 1 }
  }
}

# API, gateway and worker share one shape: identity, registry, Key Vault secrets, env.
resource "azurerm_container_app" "backend" {
  for_each = local.app_env

  name                         = local.app_name[each.key]
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  max_inactive_revisions       = 3

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.runtime.id]
  }

  registry {
    server   = local.registry
    identity = azurerm_user_assigned_identity.runtime.id
  }

  dynamic "secret" {
    for_each = toset(values(local.app_secrets[each.key]))
    content {
      name                = secret.value
      key_vault_secret_id = local.kv_secret_url[secret.value]
      identity            = azurerm_user_assigned_identity.runtime.id
    }
  }

  # The worker has no ingress: it only polls the queue. /healthz still answers on 8080 for the probe.
  dynamic "ingress" {
    for_each = each.key == "worker" ? [] : [1]
    content {
      external_enabled           = true
      target_port                = 8080
      transport                  = "auto" # http/1.1 upgrade carries the gateway's WebSocket
      allow_insecure_connections = false
      # Reconnects during a call land on the same gateway replica (Cloud Run had the same).
      session_affinity_enabled = each.key == "gateway"
      traffic_weight {
        latest_revision = true
        percentage      = 100
      }
    }
  }

  template {
    min_replicas = local.app_size[each.key].min
    max_replicas = local.app_size[each.key].max
    # Long video joins and open streams get time to finish on a rollout.
    termination_grace_period_seconds = each.key == "api" ? 30 : 600

    container {
      name   = each.key
      image  = "${local.registry}/${each.key}:${var.image_tag}"
      cpu    = local.app_size[each.key].cpu
      memory = local.app_size[each.key].memory

      dynamic "env" {
        for_each = local.app_env[each.key]
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.app_secrets[each.key]
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      liveness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = each.key == "api" ? "/health" : "/healthz"
        interval_seconds = 30
      }
    }
  }

  lifecycle {
    # The deploy workflow rolls new images (az containerapp update --image); Terraform owns the rest.
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [
    azurerm_role_assignment.runtime_acr_pull,
    azurerm_role_assignment.runtime_kv_secrets,
    azurerm_role_assignment.runtime_blob,
    azurerm_key_vault_secret.database_url,
    azurerm_key_vault_secret.redis_url,
  ]

  tags = local.tags
}

# The web app: static build plus a /v1 proxy to the API (web/server). No secrets.
resource "azurerm_container_app" "web" {
  name                         = local.app_name.web
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  max_inactive_revisions       = 3

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.runtime.id]
  }

  registry {
    server   = local.registry
    identity = azurerm_user_assigned_identity.runtime.id
  }

  ingress {
    external_enabled           = true
    target_port                = 8080
    transport                  = "auto"
    allow_insecure_connections = false
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "web"
      image  = "${local.registry}/web:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "API_URL"
        value = "https://${local.fqdn.api}"
      }
      env {
        name  = "GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }
      # CSP media-src/connect-src for signed playback links (web/server contentSecurityPolicy).
      env {
        name  = "STORAGE_ORIGIN"
        value = trimsuffix(azurerm_storage_account.recordings.primary_blob_endpoint, "/")
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.runtime_acr_pull]

  tags = local.tags
}
