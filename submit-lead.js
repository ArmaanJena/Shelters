// netlify/functions/submit-lead.js

const fs = require('node:fs/promises');
const path = require('node:path');

const QUEUE_FILE_PATH = path.resolve(process.cwd(), 'data', 'loan-leads.json');

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
    const referralId = `SR-${timestamp}-${randomPart}`;

    await appendLeadToQueue({
      referralId,
      leadCategory: 'loan',
      submittedAt: new Date().toISOString(),
      synced: false,
      fields: {
        Name: leadData.applicantName || '',
        Phone: leadData.applicantPhone || '',
        Email: leadData.applicantEmail || '',
        'Loan Amount': leadData.loanAmount || null,
        'Tenure (Years)': leadData.loanTenure || null,
        Application: leadData.loanType || '',
        'Applicant Age': leadData.applicantAge || null,
        'Credit Score': leadData.creditScore || null,
        'Monthly Income': leadData.monthlyIncome || null,
        'Existing EMIs': leadData.existingEMIs || null,
        'Co-Applicant Name': leadData.coApplicantName || null,
        'Co-Applicant Income': leadData.coApplicantIncome || null,
        Status: 'New Lead',
        'Referral ID': referralId,
        'Submission Date': new Date().toISOString()
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Lead captured and queued for Airtable sync.',
        referralId
      })
    };
  } catch (error) {
    console.error('Error in submit-lead function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process lead.' })
    };
  }
};
