# GitHub-Only Airtable Sync (Low-Call Mode)

This project uses **build-time sync**:

1. GitHub Action runs on an 8-hour schedule (and manual runs).
2. GitHub Action runs `scripts/fetch-airtable-data.js`.
3. The script writes `data/listings.json` only when data changed.
4. GitHub Pages serves this static JSON to the frontend.

No Airtable API token is required in browser code.

## 1) Required GitHub Secrets

Set these repository secrets in **Settings -> Secrets and variables -> Actions**:

- `AIRTABLE_API_KEY` (required)
- `AIRTABLE_BASE_ID` (required, recommended as secret)
- `AIRTABLE_LEADS_API_KEY` (optional but recommended if lead push needs a separate write token)
- `AIRTABLE_LEADS_BASE_ID` (optional if leads are stored in a different base)

Optional repository variables:

- `AIRTABLE_BASE_ID` (fallback if you prefer storing base id as variable)
- `AIRTABLE_TABLE_NAME` (default: `Listings`)
- `AIRTABLE_VIEW_NAME` (optional)
- `AIRTABLE_MAX_RECORDS` (optional)
- `AIRTABLE_LEADS_TABLE_NAME` (default: `Leads`)
- `AIRTABLE_LEADS_TABLE_ID` (optional, overrides leads table name)

## 2) Workflow Triggers

The workflow file is:

- `.github/workflows/airtable-sync.yml`

It runs on:

- `workflow_dispatch` (manual run)
- 8-hour schedule (`cron`)

Optional repository variables:

- `AIRTABLE_SYNC_DEBOUNCE_SECONDS` (default `20`)
- `AIRTABLE_FETCH_MAX_RETRIES` (default `4`)
- `AIRTABLE_FETCH_TIMEOUT_MS` (default `20000`)
- `AIRTABLE_FETCH_BASE_BACKOFF_MS` (default `1000`)

## 3) Airtable Automation Setup

In low-call mode, do not trigger GitHub runs for every Airtable edit.
If you need an immediate sync, use **workflow_dispatch** (manual run).

## 4) Local Test

```bash
AIRTABLE_API_KEY=... AIRTABLE_BASE_ID=... npm run sync:airtable
```

On Windows PowerShell:

```powershell
$env:AIRTABLE_API_KEY="..."
$env:AIRTABLE_BASE_ID="..."
npm run sync:airtable
```

Then confirm:

- `data/listings.json` exists
- shape is `{ updatedAt, records }`

## 5) Security Checklist

- Revoke any previously exposed Airtable token.
- Create a new Airtable token with least privilege.
- Keep Airtable secrets only in GitHub secrets.
- Do not commit credentials in client-side JS.

## 6) Lead Intake (Google Apps Script)

Leads are captured from the static website using Google Apps Script intake, then synced into JSON queues before Airtable push.

Files:

- `integrations/google-apps-script/lead-intake.gs`
- `.github/workflows/lead-intake-sync.yml`
- `scripts/fetch-lead-intake.js`
- `data/lead-intake-config.json`

Required configuration:

- Frontend endpoint in `data/lead-intake-config.json`
- Repo secret/variable `LEAD_INTAKE_PULL_URL`
- Optional secret `LEAD_INTAKE_PULL_TOKEN`
