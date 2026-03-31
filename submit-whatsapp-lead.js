// netlify/functions/submit-whatsapp-lead.js

const DEFAULT_AIRTABLE_API_KEY =
  'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7';
const DEFAULT_AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const airtableApiKey = process.env.AIRTABLE_API_KEY || DEFAULT_AIRTABLE_API_KEY;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID || DEFAULT_AIRTABLE_BASE_ID;
  const tableName = 'Leads';
  const airtableUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(tableName)}`;

  try {
    const payload = JSON.parse(event.body || '{}');
    const name = (payload.name || '').toString().trim();
    const phone = (payload.phone || '').toString().trim();
    const message = (payload.message || '').toString().trim();
    const leadType = (payload.leadType || '').toString().trim() || 'General Enquiry';
    const istTimestamp = `${new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(new Date())} IST`;

    if (!name || !phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name and Phone are required.' })
      };
    }

    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const referralId = `SW-${timestamp}-${randomPart}`;

    const record = {
      fields: {
        Name: name,
        Phone: phone,
        Message: [message, `Timestamp: ${istTimestamp}`].filter(Boolean).join('\n'),
        'Lead Property': leadType
      }
    };

    const response = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${airtableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: [record] })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Airtable API Error (${response.status}):`, errorBody);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Failed to save WhatsApp lead to Airtable.' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'WhatsApp lead captured successfully.', referralId })
    };
  } catch (error) {
    console.error('Error in submit-whatsapp-lead function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process WhatsApp lead.' })
    };
  }
};
