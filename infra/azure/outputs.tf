output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "registry" {
  value = azurerm_container_registry.main.login_server
}

output "key_vault" {
  value = azurerm_key_vault.main.name
}

output "storage_account" {
  value = azurerm_storage_account.recordings.name
}

output "api_url" {
  value = "https://${local.fqdn.api}"
}

output "web_url" {
  value = "https://${local.fqdn.web}"
}

output "gateway_ws_url" {
  value = "wss://${local.fqdn.gateway}/v1/stream"
}

# GitHub repository variables for .github/workflows/deploy-staging.yml (runbook A.6).
output "github_variables" {
  value = {
    AZURE_CLIENT_ID       = azurerm_user_assigned_identity.deployer.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = var.subscription_id
    AZURE_RESOURCE_GROUP  = azurerm_resource_group.main.name
    AZURE_REGISTRY        = azurerm_container_registry.main.login_server
  }
}
