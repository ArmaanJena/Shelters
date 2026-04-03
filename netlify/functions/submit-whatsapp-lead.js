const fs = require('node:fs/promises');
const path = require('node:path');
const { sanitizeText, sanitizePhone } = require('../../scripts/input-sanitizer');

const QUEUE_FILE_PATH = path.resolve(process.cwd(), 'data', 'whatsapp-leads.json');

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
  const queuedLeads = await readQueuedLeads();
  queuedLeads.push(lead);
  await fs.writeFile(QUEUE_FILE_PATH, `${JSON.stringify(queuedLeads, null, 2)}\n`, 'utf8');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const name = sanitizeText(payload.name, { maxLength: 120 });
    const phone = sanitizePhone(payload.phone);
    const message = sanitizeText(payload.message, { preserveNewlines: true, maxLength: 2000 });
    const leadType = sanitizeText(payload.leadType, { maxLength: 120 }) || 'General Enquiry';

    if (!name || !phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name and Phone are required.' })
      };
    }

    const submittedAt = new Date().toISOString();
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const referralId = `SW-${Date.now()}-${randomPart}`;

    await appendLeadToQueue({
      referralId,
      name,
      phone,
      message,
      leadType,
      submittedAt,
      synced: false
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'WhatsApp lead captured and queued for Airtable sync.',
        referralId
      })
    };
  } catch (error) {
    console.error('Error in submit-whatsapp-lead function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process WhatsApp lead.' })
    };
  }
};
