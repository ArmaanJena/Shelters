const {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeNumber,
  sanitizeAirtableFields
} = require('../../scripts/input-sanitizer');
const { appendLeadToQueue } = require('../../scripts/lead-queue-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const leadData = JSON.parse(event.body || '{}');
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const referralId = `SR-${timestamp}-${randomPart}`;

    const sanitizedFields = sanitizeAirtableFields({
      Name: sanitizeText(leadData.applicantName, { maxLength: 120 }),
      Phone: sanitizePhone(leadData.applicantPhone),
      Email: sanitizeEmail(leadData.applicantEmail),
      'Loan Amount': sanitizeNumber(leadData.loanAmount),
      'Tenure (Years)': sanitizeNumber(leadData.loanTenure),
      Application: sanitizeText(leadData.loanType, { maxLength: 120 }),
      'Applicant Age': sanitizeNumber(leadData.applicantAge),
      'Credit Score': sanitizeNumber(leadData.creditScore),
      'Monthly Income': sanitizeNumber(leadData.monthlyIncome),
      'Existing EMIs': sanitizeNumber(leadData.existingEMIs),
      'Co-Applicant Name': sanitizeText(leadData.coApplicantName, { maxLength: 120 }) || null,
      'Co-Applicant Income': sanitizeNumber(leadData.coApplicantIncome),
      Status: 'New Lead',
      'Referral ID': referralId,
      'Submission Date': new Date().toISOString()
    });

    if (!sanitizedFields.Name || !sanitizedFields.Phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name and Phone are required.' })
      };
    }

    await appendLeadToQueue({
      queueFile: 'data/loan-leads.json',
      commitMessage: `chore: queue loan lead ${referralId}`,
      lead: {
        referralId,
        leadCategory: 'loan',
        submittedAt: new Date().toISOString(),
        synced: false,
        fields: sanitizedFields
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
