# Airtable Automation Setup Guide

This guide explains how to connect your website to Airtable for automatic data updates and lead notifications.

---

## 1. Add Environment Variables

Your website needs secret keys to talk to Airtable. You must add these in your website hosting provider's settings (like Vercel or Netlify), not directly in the code.

1.  Go to your project's **Settings** page on Vercel or Netlify.
2.  Find the **Environment Variables** section.
3.  Add the following two variables:
    *   `AIRTABLE_API_KEY`: Your Airtable API key. Find it in your [Airtable account settings](https://airtable.com/account).
    *   `AIRTABLE_BASE_ID`: The ID of your Airtable base. Find it in the [API documentation](https://airtable.com/api) for your base.

**Optional Variables:**
You might need these later for other features:
*   `GAMMA_API_KEY`
*   `RECAPTCHA_SECRET`

---

## 2. Create a Deploy Hook

A deploy hook is a special URL that tells your website to rebuild itself. We will trigger this from Airtable.

*   **On Vercel:** Go to **Settings > Git > Deploy Hooks**. Create a new hook, give it a name (e.g., "Airtable Update"), and copy the URL.
*   **On Netlify:** Go to **Site settings > Build & deploy > Build hooks**. Create a new build hook, name it "Airtable Update", and copy the URL.

Keep this URL handy for the next step.

---

## 3. Set Up Airtable Automations

### Automation 1: Daily Website Rebuild

This automation will automatically rebuild your website every day or so to fetch the latest listings and blog posts from Airtable.

1.  Open your Airtable base and click on **Automations** in the top bar.
2.  Create a new automation.
3.  Set the **Trigger**: Choose **"At a scheduled time"**. Set it to run once a day (or every 2-3 days).
4.  Set the **Action**:
    *   Choose the **"Send webhook"** action.
    *   In the **URL** box, paste the Deploy Hook URL you copied from Vercel/Netlify.
    *   Under **Body**, select the **JSON** format.
    *   Copy and paste the following into the JSON text area:

    ```json
    {
      "trigger": "airtable_scheduled"
    }
    ```

### Automation 2: New Lead Notification

This automation sends an email whenever a new lead is submitted through your website's form.

1.  In the same Airtable **Automations** section, create another automation.
2.  Set the **Trigger**: Choose **"When a record is created"**. Select your `Leads` table.
3.  Set the **Action**: Choose **"Send an email"**.
4.  Configure the email:
    *   **To**: Enter your email address.
    *   **Subject**: `New Lead: [Name]` (You can click the blue `+` button to insert the "Name" field from the record).
    *   **Message**: Draft a message and use the `+` button to insert data from the new record. Example:

    ```
    A new lead has been submitted.

    Name: {Name}
    Phone: {Phone}
    Source: {Source}
    Listing ID: {Listing ID}
    ```
5.  Turn on both automations.

---

## 4. Testing

*   **Test the Rebuild Automation**: In the Airtable automation editor, click the "Run test" button for the scheduled automation. You should see a new deployment start immediately in your Vercel or Netlify project dashboard.
*   **Test the Lead Form**: Go to your live website and submit a test lead through the contact or lead form. The new record should appear in your Airtable `Leads` table within a few moments, and you should receive the email notification you configured.

---

## 5. Safety & Troubleshooting

*   **NEVER** expose your `AIRTABLE_API_KEY` or other secrets in your website's code.
*   Only use official Airtable forms or secure serverless functions to handle lead submissions. Do not build custom forms that send data directly from the browser to Airtable without a secure backend process.
*   If the website data seems outdated, check the **deployment logs** in Vercel or Netlify. Any errors during the `node scripts/fetch-airtable-data.js` step will be shown there.
