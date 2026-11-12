# infra/azure — staging on Azure (ADR-0012)

Central India (Pune). Container Apps (`api`, `gateway`, `web`, `worker`), Container Apps Jobs
(`migrate`, `smoke`), Postgres Flexible Server 16, Azure Managed Redis, Blob Storage (user
delegation SAS), Key Vault, Container Registry, Log Analytics, and the GitHub OIDC deployer.

| File | What |
|---|---|
| `main.tf` | resource group, logs, registry, runtime identity, Key Vault, recordings storage |
| `data.tf` | Postgres and Redis |
| `apps.tf` | Container Apps environment and apps (env, Key Vault references, probes) |
| `jobs.tf` | migrate and smoke jobs |
| `ci.tf` | deployer identity, federated credential, roles |

Step-by-step: [docs/STAGING_SETUP.md, Part A](../../docs/STAGING_SETUP.md). Apply with
`-target` in the order given there. Images are rolled by `.github/workflows/deploy-staging.yml`;
Terraform ignores image changes. `terraform.tfvars` and state hold passwords: never commit them.

CI runs `terraform validate` here on every push (no credentials).
