// netlify/functions/submit-lead.js

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
    const tableName = 'Leads'; // Assuming you have a 'Leads' table in Airtable
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;

    try {
        const leadData = JSON.parse(event.body);

        // --- Generate a simplified, unique Referral ID ---
        const timestamp = Date.now(); // Milliseconds since epoch, ensures uniqueness and sort order
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase(); // 5-character random string
        const referralId = `SR-${timestamp}-${randomPart}`;

        // Map incoming data to Airtable field names
        // Note: Ensure these field names match your Airtable columns exactly.
        const airtableRecord = {
            fields: {
                "Name": leadData.applicantName,
                "Phone": leadData.applicantPhone,
                "Email": leadData.applicantEmail,
                "Loan Amount": leadData.loanAmount,
                "Tenure (Years)": leadData.loanTenure,
                "Application": leadData.loanType,
                "Applicant Age": leadData.applicantAge,
                "Credit Score": leadData.creditScore,
                "Monthly Income": leadData.monthlyIncome,
                "Existing EMIs": leadData.existingEMIs,
                "Co-Applicant Name": leadData.coApplicantName || null,
                "Co-Applicant Income": leadData.coApplicantIncome || null,
                "Status": "New Lead", // Default status
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
            throw new Error('Failed to save lead to Airtable.');
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Lead captured successfully.', referralId: referralId }),
        };

    } catch (error) {
        console.error('Error in submit-lead function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process lead.' }),
        };
    }
};