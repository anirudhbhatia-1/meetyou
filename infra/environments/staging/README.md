# MeetYou Staging Infrastructure (Google Cloud Mumbai)

> **Not in use since 2026-11-12.** Staging moved to Azure ([ADR-0012](../../docs/adr/0012-azure-hosting.md),
> [`infra/azure`](../../azure/README.md)). Kept for reference until production hosting is decided.

This directory manages the core staging cloud infrastructure for **MeetYou** in region **`asia-south1` (Mumbai)** via Terraform, compliant with [ADR-0002](../../docs/adr/0002-backend-stack-and-hosting.md).

---

## 1. Prerequisites

1. **Google Cloud SDK (`gcloud`)** installed.
2. **Terraform (>= 1.5.0)** or **OpenTofu** installed.
3. A Google Cloud billing-enabled project.

---

## 2. One-Time Setup Runbook

### Step 1: Authenticate with Google Cloud
```bash
gcloud auth login
gcloud auth application-default login
```

### Step 2: Set your project
```bash
gcloud config set project <YOUR_PROJECT_ID>
```

### Step 3: Configure Terraform variables
Copy the example variables file:
```bash
cp terraform.tfvars.example terraform.tfvars
```
Edit `terraform.tfvars` with:
- `project_id`: your Google Cloud Project ID.
- `db_password`: a strong random database password.

*(Note: `terraform.tfvars` is gitignored to protect secrets).*

---

## 3. Provisioning

From this directory (`infra/environments/staging/`):

```bash
# Initialize providers and modules
terraform init

# Review changes
terraform plan

# Deploy infrastructure
terraform apply
```

---

## 4. What uses this, and when

- **STT:** Deepgram only (ADR-0001 §0, 2026-11-05). The Speech-to-Text API and role are not
  needed; S1-14 was cancelled.
- **Gateway (S1-05):** the service runs a placeholder image. The real gateway is deployed after S2
  sign-in (ADR-0004): its dev endpoints have no auth, and it refuses to start with
  `APP_ENV=staging` until then. Until then, test against the local gateway.
- **Video uploads (ADR-0011 §3.3):** set `extension_origins` to the extension's
  `chrome-extension://<id>` origin so signed PUTs pass CORS. The Meet page origin is never allowed.
- **Storage lifecycle:** 31 days, a backstop above the longest user retention (30 days, D-02). The
  retention job (S2-10) does the real deletion.

## 5. Cost while idle

Cloud Run scales to zero, but the Cloud SQL instance and the VPC connector (two `e2-micro`
instances) run around the clock. Until S2 needs the database, stop the instance:
`gcloud sql instances patch meetyou-staging-pg16 --activation-policy=NEVER` (data is kept; only
storage is billed). Start it again with `--activation-policy=ALWAYS`.

