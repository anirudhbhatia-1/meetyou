# infra/azure — staging on Azure (ADR-0012)

Central India (Pune). Container Apps (`api`, `gateway`, `web`, `worker`) and Container Apps Jobs
(`migrate`, `smoke`) in a shared existing environment, Azure Managed Redis, Blob Storage (user
delegation SAS), Key Vault, Container Registry, and the GitHub OIDC deployer. Postgres is a
Supabase project (Mumbai) reached through its session pooler; `create-app-role.mjs` makes the
`meetyou_app` role there.

| File | What |
|---|---|
| `main.tf` | resource group, registry, runtime identity, Key Vault, recordings storage |
| `data.tf` | Redis (Postgres is Supabase, see ADR-0012 §2.3) |
| `apps.tf` | the shared environment (data source) and the apps (env, Key Vault references, probes) |
| `jobs.tf` | migrate and smoke jobs |
| `ci.tf` | deployer identity, federated credential, roles |

Step-by-step: [docs/STAGING_SETUP.md, Part A](../../docs/STAGING_SETUP.md). Apply with
`-target` in the order given there. Images are rolled by `.github/workflows/deploy-staging.yml`;
Terraform ignores image changes. `terraform.tfvars` and state hold passwords: never commit them.

CI runs `terraform validate` here on every push (no credentials).
