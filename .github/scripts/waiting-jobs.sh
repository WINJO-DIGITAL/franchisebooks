#!/usr/bin/env bash
# Prints how many DPD jobs are queued and due to run now (a number), using the Supabase REST API.
# Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Prints "unknown" and exits 1 if it cannot tell,
# in which case the workflow runs anyway (better a spare run than a missed night).
set -euo pipefail
url="${NEXT_PUBLIC_SUPABASE_URL:-}"
key="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [ -z "$url" ] || [ -z "$key" ]; then echo unknown; exit 1; fi
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
headers=$(curl -fsS -o /dev/null -D - --max-time 15 \
  -H "apikey: ${key}" -H "authorization: Bearer ${key}" -H "Prefer: count=exact" -H "Range: 0-0" \
  "${url%/}/rest/v1/import_jobs?select=id&status=eq.queued&job_type=in.(dpd_sync,dpd_discovery)&run_after=lte.${now}") || { echo unknown; exit 1; }
total=$(printf '%s' "$headers" | tr -d '\r' | awk -F'/' 'tolower($0) ~ /^content-range:/ { print $2 }')
if [[ "$total" =~ ^[0-9]+$ ]]; then echo "$total"; else echo unknown; exit 1; fi
