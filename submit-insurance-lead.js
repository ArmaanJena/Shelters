// netlify/functions/submit-insurance-lead.js

const fs = require('node:fs/promises');
const path = require('node:path');

const QUEUE_FILE_PATH = path.resolve(process.cwd(), 'data', 'insurance-leads.json');

async function readQueuedLeads() {
  try {
    const raw = await fs.readFile(QUEUE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendLeadToQueue(lead) {
  await fs.mkdir(path.dirname(QUEUE_FILE_PATH), { recursive: true });
  const queued = await readQueuedLeads();
  queued.push(lead);
  await fs.writeFile(QUEUE_FILE_PATH, `${JSON.stringify(queued, null, 2)}\n`, 'utf8');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const leadData = JSON.parse(event.body || '{}');
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const referralId = `SI-${timestamp}-${randomPart}`;

    await appendLeadToQueue({
      referralId,
      leadCategory: 'insurance',
      submittedAt: new Date().toISOString(),
      synced: false,
      fields: {
        Name: leadData.applicantName || 'N/A',
        Phone: leadData.applicantPhone || 'N/A',
        Email: leadData.applicantEmail || 'N/A',
        Message: leadData.message || '',
        Type: 'Insurance',
        Status: 'New Lead',
        'Referral ID': referralId,
        'Submission Date': new Date().toISOString()
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Insurance inquiry queued for Airtable sync.',
        referralId
      })
    };
  } catch (error) {
    console.error('Error in submit-insurance-lead function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process insurance inquiry.' })
    };
  }
};
