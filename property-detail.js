// property-detail.js
// Fetches and displays property details from Airtable using record ID in URL

const AIRTABLE_API_KEY = 'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7'; // <-- Your Airtable token
const AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5'; // <-- Your Airtable Base ID
const AIRTABLE_TABLE_NAME = 'Properties';
const AIRTABLE_ENDPOINT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`;

function getRecordIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

async function fetchPropertyDetail(recordId) {
    const url = `${AIRTABLE_ENDPOINT}/${recordId}`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) throw new Error('Failed to fetch property details.');
    return res.json();
}

function renderPropertyDetail(record) {
    const fields = record.fields;
    const imageUrl = fields['Image']?.[0]?.url || 'https://via.placeholder.com/800x400?text=No+Image';
    const title = fields['Title'] || 'Untitled';
    const location = fields['Location'] || 'Unknown';
    const price = fields['Price'] ? `₹${fields['Price'].toLocaleString()}` : 'Price on request';
    const description = fields['Description'] || '';
    const whatsappNumber = '919860826918'; // Updated WhatsApp number
    const whatsappMsg = encodeURIComponent(`Hi, I'm interested in the property: ${title} (${location}) for ${price}`);
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=${whatsappMsg}`;

    return `
        <div class="property-detail-header">
            <img src="${imageUrl}" alt="${title}" class="property-detail-image" />
            <div class="property-detail-info">
                <div class="property-detail-title">${title}</div>
                <div class="property-detail-location">${location}</div>
                <div class="property-detail-price">${price}</div>
                <div class="property-detail-description">${description}</div>
                <a href="${whatsappLink}" class="whatsapp-cta" target="_blank" rel="noopener">Enquire on WhatsApp</a>
            </div>
        </div>
    `;
}

async function initPropertyDetail() {
    const container = document.getElementById('property-detail-container');
    const recordId = getRecordIdFromUrl();
    if (!recordId) {
        container.innerHTML = '<div class="error">No property ID provided.</div>';
        return;
    }
    // Show spinner while loading
    container.innerHTML = `
      <div class="loading" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; min-height: 120px; justify-content: center;">
        <div class="spinner" style="border: 4px solid #e2e8f0; border-top: 4px solid #2563eb; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite;"></div>
        <span>Loading property...</span>
      </div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;
    try {
        const record = await fetchPropertyDetail(recordId);
        container.innerHTML = renderPropertyDetail(record);
    } catch (err) {
        container.innerHTML = `<div class=\"error\">${err.message}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', initPropertyDetail);
