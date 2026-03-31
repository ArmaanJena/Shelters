# GitHub-Only Airtable Sync (Event-Driven)

This project uses **build-time sync**:

1. Airtable record changes trigger GitHub `repository_dispatch`.
2. GitHub Action runs `scripts/fetch-airtable-data.js`.
3. The script writes `data/listings.json` only when data changed.
4. GitHub Pages serves this static JSON to the frontend.

No Airtable API token is required in browser code.

## 1) Required GitHub Secrets

Set these repository secrets in **Settings -> Secrets and variables -> Actions**:

- `AIRTABLE_API_KEY` (required)
- `AIRTABLE_BASE_ID` (required)
- `AIRTABLE_TABLE_NAME` (optional, default: `Properties`)
- `AIRTABLE_VIEW_NAME` (optional)
- `AIRTABLE_MAX_RECORDS` (optional)

## 2) Workflow Triggers

The workflow file is:

- `.github/workflows/airtable-sync.yml`

It runs on:

- `repository_dispatch` with event type `airtable_changed`
- `workflow_dispatch` (manual run)
- daily safety schedule (`cron`)

Near-real-time behavior:

- `repository_dispatch` runs are debounced by default (`20s`) to coalesce rapid edits.
- Concurrency cancellation is enabled, so only the most recent burst run proceeds.

Optional repository variables:

- `AIRTABLE_SYNC_DEBOUNCE_SECONDS` (default `20`)
- `AIRTABLE_FETCH_MAX_RETRIES` (default `4`)
- `AIRTABLE_FETCH_TIMEOUT_MS` (default `20000`)
- `AIRTABLE_FETCH_BASE_BACKOFF_MS` (default `1000`)

## 3) Airtable Automation Setup (Recommended)

Create an Airtable Automation:

1. Trigger: **When record created/updated/deleted** on `Properties`.
2. Action: **Send webhook** to GitHub REST API:
   - URL: `https://api.github.com/repos/<OWNER>/<REPO>/dispatches`
   - Method: `POST`
   - Headers:
     - `Accept: application/vnd.github+json`
     - `Authorization: Bearer <GITHUB_DISPATCH_TOKEN>`
     - `Content-Type: application/json`
   - JSON body:

```json
{
  "event_type": "airtable_changed",
  "client_payload": {
    "table": "Properties"
  }
}
```

`GITHUB_DISPATCH_TOKEN` should be a token that can call repository dispatch on the target repo.

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
