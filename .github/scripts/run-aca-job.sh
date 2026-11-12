#!/usr/bin/env bash
# Start a Container Apps job and wait for it (the Azure counterpart of `gcloud run jobs execute
# --wait`). Exits non-zero when the execution fails or does not finish within 20 minutes.
set -euo pipefail

job="$1"
rg="$2"

execution=$(az containerapp job start --name "$job" --resource-group "$rg" --query name -o tsv)
echo "started $job execution $execution"

for _ in $(seq 1 120); do
  status=$(az containerapp job execution show --name "$job" --resource-group "$rg" \
    --job-execution-name "$execution" --query properties.status -o tsv)
  case "$status" in
    Succeeded)
      echo "$job: $status"
      exit 0
      ;;
    Failed | Stopped | Degraded)
      echo "::error::$job execution $execution ended with $status (logs: Log Analytics, ContainerAppConsoleLogs_CL)"
      exit 1
      ;;
  esac
  sleep 10
done

echo "::error::$job execution $execution did not finish in 20 minutes (last status: $status)"
exit 1
