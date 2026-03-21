// netlify/functions/submit-insurance-lead.js

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
    const tableName = 'Leads'; // We'll use the same 'Leads' table
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;

    try {
        const leadData = JSON.parse(event.body);

        // --- Generate a unique Insurance Referral ID ---
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
        const referralId = `SI-${timestamp}-${randomPart}`; // "SI" for Shelters Insurance

        // Map incoming data to Airtable field names
        const airtableRecord = {
            fields: {
                "Name": leadData.applicantName || 'N/A',
                "Phone": leadData.applicantPhone || 'N/A',
                "Email": leadData.applicantEmail || 'N/A',
                "Message": leadData.message,
                "Type": "Insurance", // Set the lead type
                "Status": "New Lead",
                "Referral ID": referralId,
                "Submission Date": new Date().toISOString(),
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ records: [airtableRecord] }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Airtable API Error: ${response.status}`, errorBody);
            throw new Error('Failed to save insurance lead to Airtable.');
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Insurance inquiry captured successfully.', referralId: referralId }),
        };

    } catch (error) {
        console.error('Error in submit-insurance-lead function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process insurance inquiry.' }),
        };
    }
};