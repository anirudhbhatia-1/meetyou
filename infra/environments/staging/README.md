# MeetYou Staging Infrastructure (Google Cloud Mumbai)

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

## 4. Unblocking Stage 1 Tasks

### For Anirudh (S1-14: Google Chirp 3 Benchmark Gate):
Once this project exists, set the project ID in `tools/stt-benchmark/.env.bench`:
```env
GOOGLE_CLOUD_PROJECT=<YOUR_PROJECT_ID>
```
Ensure your ADC login is complete (`gcloud auth application-default login`). You can now run the benchmark gate:
```bash
pnpm --filter @meetyou/stt-benchmark run-google
```

### For Gateway Deployment (S1-05):
Cloud Run will output `gateway_url`. Point the extension build to the staging gateway:
```bash
MINUTES_GATEWAY_URL=<GATEWAY_URL> pnpm --filter @meetyou/extension build
```

