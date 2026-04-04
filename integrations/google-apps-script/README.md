# Google Apps Script Lead Intake Setup

This project can accept leads from the static site through a Google Apps Script web app.

## 1) Deploy Apps Script

1. Go to [script.new](https://script.new) while signed in with your Google account.
2. Attach a Google Sheet (or create one) for lead storage.
3. Replace default code with [`lead-intake.gs`](./lead-intake.gs).
4. Save project.
5. In Apps Script, set script property:
   - Key: `LEAD_INTAKE_PULL_TOKEN`
   - Value: strong random token
6. Deploy as **Web app**:
   - Execute as: `Me`
   - Who has access: `Anyone`
7. Copy the deployment URL, looks like:
   - `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

## 2) Configure Frontend Lead Submit Endpoint

Update [`data/lead-intake-config.json`](../../data/lead-intake-config.json):

```json
{
  "updatedAt": "2026-04-04T00:00:00.000Z",
  "endpoint": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
}
```

## 3) Configure Lead Intake Sync Workflow

Set repository secrets/variables:

- `LEAD_INTAKE_PULL_URL`:
  - `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?token=<LEAD_INTAKE_PULL_TOKEN>`
- `LEAD_INTAKE_PULL_TOKEN`:
  - same token value (optional if already in URL, recommended for future endpoints)

The workflow [`lead-intake-sync.yml`](../../.github/workflows/lead-intake-sync.yml) will:

1. Pull leads from Apps Script
2. Append them to:
   - `data/whatsapp-leads.json`
   - `data/loan-leads.json`
   - `data/insurance-leads.json`
3. Commit queue updates

Then existing Airtable sync job pushes queued leads to Airtable.

## Notes

- Frontend uses `no-cors` transport for Google Apps Script endpoints to avoid browser preflight/CORS failures.
- Lead delivery is treated as successful if the request is sent successfully from browser.
