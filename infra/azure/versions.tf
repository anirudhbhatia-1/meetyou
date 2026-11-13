# Azure staging (ADR-0012). Runbook: docs/STAGING_SETUP.md "Azure". Apply with -target in the
# order the runbook gives; never a blanket apply on a shared state without reading the plan.
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
      # 5.13 adds session_affinity_enabled on azurerm_container_app (gateway reconnects).
      version = "~> 5.13"
    }
  }

  # Local state for the first apply; move it to a storage account afterwards (runbook A.2).
  # backend "azurerm" {
  #   resource_group_name  = "meetyou-tfstate"
  #   storage_account_name = "<tfstate account>"
  #   container_name       = "tfstate"
  #   key                  = "staging.tfstate"
  #   use_azuread_auth     = true
  # }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # The storage account has shared keys off; containers and policies are managed with Entra ID.
  storage_use_azuread = true
}

data "azurerm_client_config" "current" {}
