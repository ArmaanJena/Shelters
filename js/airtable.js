// airtable.js
// Integrates Airtable as CMS for property listings
// Insert your API key and Base ID below

// IMPORTANT: API key removed for security. Create a local-only version for development.
const AIRTABLE_API_KEY = 'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7'; // <-- Your Airtable token
const AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5'; // <-- Your Airtable Base ID
const AIRTABLE_TABLE_NAME = 'Properties';
const AIRTABLE_ENDPOINT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`;

const listingsContainer = document.getElementById('property-listings');

function showLoading() {
  listingsContainer.innerHTML = '<div class="loading">Loading...</div>';
}

function showError(message) {
  listingsContainer.innerHTML = `<div class="error">${message}</div>`;
}

async function fetchListings() {
  showLoading();
  try {
    const response = await fetch(AIRTABLE_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch listings.');
    }
    const data = await response.json();
    renderListings(data.records);
  } catch (error) {
    showError(error.message);
  }
}

function renderListings(records) {
  if (!records || records.length === 0) {
    listingsContainer.innerHTML = '<div class="no-listings">No properties found.</div>';
    return;
  }
  listingsContainer.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'property-grid';
  records.forEach(record => {
    const card = createPropertyCard(record);
    grid.appendChild(card);
  });
  listingsContainer.appendChild(grid);
}

function createPropertyCard(record) {
  const fields = record.fields;
  const imageUrl = fields['Image']?.[0]?.url || 'https://via.placeholder.com/400x250?text=No+Image';
  const title = fields['Title'] || 'Untitled';
  const location = fields['Location'] || 'Unknown';
  const price = fields['Price'] ? `₹${fields['Price'].toLocaleString()}` : 'Price on request';
  const description = fields['Description'] ? truncateText(fields['Description'], 120) : '';

  // Use bento-card style for consistency with home page
  const wrapper = document.createElement('div');
  wrapper.className = 'bento-card-wrapper';
  const card = document.createElement('div');
  card.className = 'bento-card';

  card.innerHTML = `
    <div class="listing-image-container">
      <img class="property-image" src="${imageUrl}" alt="${title}" loading="lazy" />
    </div>
    <div class="bento-content" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
      <h3 class="property-title">${title}</h3>
      <div class="property-location">${location}</div>
      <div class="property-price">${price}</div>
      <div class="property-description">${description}</div>
    </div>
  `;
  wrapper.appendChild(card);
  return wrapper;
}

function truncateText(text, maxLength) {
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '...';
  }
  return text;
}

// Initialize fetch on page load
if (listingsContainer) {
  fetchListings();
}

// ---
// Instructions:
// 1. Replace 'YOUR_API_KEY_HERE' and 'YOUR_BASE_ID_HERE' with your Airtable API key and Base ID.
// 2. Place this file in /js/airtable.js
// 3. Ensure <div id="property-listings"></div> exists in your HTML.
// 4. Add <script src="js/airtable.js"></script> before </body>.
// ---
