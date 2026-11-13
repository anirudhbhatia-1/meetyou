# CI/CD identity (ADR-0012): GitHub Actions on main logs in with its OIDC token through a federated
# credential. No client secret exists anywhere. It pushes images and rolls the apps and jobs in
# this resource group only.
resource "azurerm_user_assigned_identity" "deployer" {
  name                = "${local.prefix}-deployer"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_main" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.deployer.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  # The deploy job runs in the "staging" GitHub environment, so its token's subject is the
  # environment, not the branch. Environment protection limits it to main (runbook A.6).
  subject = var.github_oidc_subject
}

resource "azurerm_role_assignment" "deployer_acr_push" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.deployer.principal_id
  principal_type       = "ServicePrincipal"
}

# Update container apps and start jobs. Contributor on the resource group is broader than needed;
# a custom role limited to Microsoft.App/* is Stage-5 hardening.
resource "azurerm_role_assignment" "deployer_apps" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.deployer.principal_id
  principal_type       = "ServicePrincipal"
}
