// netlify/functions/submit-insurance-lead.js

const {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeAirtableFields
} = require('./scripts/input-sanitizer');
const { appendLeadToQueue } = require('./scripts/lead-queue-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const leadData = JSON.parse(event.body || '{}');
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const referralId = `SI-${timestamp}-${randomPart}`;
    const safeName = sanitizeText(leadData.applicantName, { maxLength: 120 });
    const safePhone = sanitizePhone(leadData.applicantPhone);

    const sanitizedFields = sanitizeAirtableFields({
      Name: safeName || 'N/A',
      Phone: safePhone || 'N/A',
      Email: sanitizeEmail(leadData.applicantEmail) || 'N/A',
      Message: sanitizeText(leadData.message, { preserveNewlines: true, maxLength: 2000 }),
      Type: 'Insurance',
      Status: 'New Lead',
      'Referral ID': referralId,
      'Submission Date': new Date().toISOString()
    });

    if (!safeName || !safePhone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name and Phone are required.' })
      };
    }

    await appendLeadToQueue({
      queueFile: 'data/insurance-leads.json',
      commitMessage: `chore: queue insurance lead ${referralId}`,
      lead: {
        referralId,
        leadCategory: 'insurance',
        submittedAt: new Date().toISOString(),
        synced: false,
        fields: sanitizedFields
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
