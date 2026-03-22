// airtable.js
// Integrates Airtable as CMS for property listings
// Insert your API key and Base ID below

// IMPORTANT: API key removed for security. Create a local-only version for development.
//const AIRTABLE_API_KEY = 'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7'; // <-- Your Airtable token
const AIRTABLE_API_KEY = 'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7'; // <-- Your Airtable token
const AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5'; // <-- Your Airtable Base ID
const AIRTABLE_TABLE_NAME = 'Properties';
const AIRTABLE_ENDPOINT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`;

const listingsContainer = document.getElementById('property-listings');

function showLoading() {
  listingsContainer.innerHTML = `
    <div class="loading" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; min-height: 120px; justify-content: center;">
      <div class="spinner" style="border: 4px solid #e2e8f0; border-top: 4px solid #2563eb; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite;"></div>
      <span>Loading properties...</span>
    </div>
    <style>
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;
}

function showError(message) {
  listingsContainer.innerHTML = `<div class="error">${message}</div>`;
}


// Store all fetched listings for client-side filtering/sorting
let allListings = [];

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
    allListings = data.records || [];
    if (allListings.length === 0) {
      showError('No properties found from Airtable.');
    } else {
      applyFiltersAndRender();
    }
  } catch (error) {
    showError('Airtable API error: ' + error.message + '<br><br><b>Showing a test property for UI debugging.</b>');
    // Add a test property so UI can be tested
    allListings = [{
      id: 'test1',
      fields: {
        Title: 'Test Property',
        Location: 'Viman Nagar',
        Type: 'Flat',
        ListingType: 'Buy',
        Price: 12345678,
        Description: 'This is a test property. If you see this, Airtable API is not working.',
        Image: []
      }
    }];
    applyFiltersAndRender();
  }
}

// Filtering and sorting logic

function applyFiltersAndRender() {
  let filtered = [...allListings];

  // Get filter values
  const location = document.getElementById('filter-location')?.value || '';
  const type = document.getElementById('filter-type')?.value || '';
  const listingType = document.getElementById('filter-listing-type')?.value || '';
  const minPrice = parseInt(document.getElementById('filter-min-price')?.value, 10);
  const maxPrice = parseInt(document.getElementById('filter-max-price')?.value, 10);
  const sort = document.getElementById('sort-price')?.value || 'default';

  filtered = filtered.filter(record => {
    const f = record.fields;
    let pass = true;
    if (location && f['Location'] !== location) pass = false;
    if (type && f['Type'] !== type) pass = false;
    if (listingType && f['ListingType'] !== listingType) pass = false;
    const price = Number(f['Price']) || 0;
    if (!isNaN(minPrice) && minPrice > 0 && price < minPrice) pass = false;
    if (!isNaN(maxPrice) && maxPrice > 0 && price > maxPrice) pass = false;
    return pass;
  });
  renderListings(filtered);
  updateResultsSummary(filtered.length);
}

function updateResultsSummary(count) {
  const summary = document.getElementById('results-summary');
  if (summary) {
    if (count === 0) {
      summary.innerHTML = 'No properties found';
    } else {
      summary.innerHTML = `Showing <strong>${count}</strong> propert${count === 1 ? 'y' : 'ies'}`;
    }
  }
}

// Event listeners for filters and sort (with debug logging)
document.addEventListener('DOMContentLoaded', () => {
  console.log('[airtable.js] DOMContentLoaded fired');
  // Only run on listings page
  const listingsDiv = document.getElementById('property-listings');
  if (!listingsDiv) {
    console.warn('[airtable.js] #property-listings not found. Script will not run.');
    return;
  }
  fetchListings();
  const filterIds = ['filter-location', 'filter-type', 'filter-listing-type', 'filter-min-price', 'filter-max-price', 'sort-price'];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', applyFiltersAndRender);
      console.log(`[airtable.js] Attached change event to #${id}`);
    } else {
      console.warn(`[airtable.js] Filter element #${id} not found`);
    }
  });

  // Price range slider sync logic
  const priceSlider = document.getElementById('filter-price-range');
  const minInput = document.getElementById('filter-min-price');
  const maxInput = document.getElementById('filter-max-price');
  const minLabel = document.getElementById('min-price-label');
  const maxLabel = document.getElementById('max-price-label');
  const SLIDER_MAX = 100000000;

  // Set slider and input sync
  if (priceSlider && minInput && maxInput) {
    // When slider changes, update min/max inputs
    priceSlider.addEventListener('input', () => {
      const val = parseInt(priceSlider.value, 10);
      minInput.value = 0;
      maxInput.value = val > 0 ? val : '';
      maxLabel.textContent = val >= SLIDER_MAX ? '₹10 Cr+' : `₹${val.toLocaleString()}`;
      applyFiltersAndRender();
    });
    // When min/max inputs change, update slider and labels
    minInput.addEventListener('input', () => {
      applyFiltersAndRender();
    });
    maxInput.addEventListener('input', () => {
      const val = parseInt(maxInput.value, 10);
      if (!isNaN(val)) {
        priceSlider.value = val;
        maxLabel.textContent = val >= SLIDER_MAX ? '₹10 Cr+' : `₹${val.toLocaleString()}`;
      } else {
        priceSlider.value = 0;
        maxLabel.textContent = '₹10 Cr+';
      }
      applyFiltersAndRender();
    });
    console.log('[airtable.js] Price slider and min/max inputs event listeners attached');
  } else {
    console.warn('[airtable.js] Price slider or min/max input not found');
  }

  // Reset button
  const resetBtn = document.getElementById('reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      document.getElementById('filter-location').value = '';
      document.getElementById('filter-type').value = '';
      document.getElementById('filter-listing-type').value = '';
      if (minInput) minInput.value = '';
      if (maxInput) maxInput.value = '';
      if (priceSlider) priceSlider.value = 0;
      if (maxLabel) maxLabel.textContent = '₹10 Cr+';
      document.getElementById('sort-price').value = 'default';
      applyFiltersAndRender();
    });
    console.log('[airtable.js] Reset filters button event attached');
  } else {
    console.warn('[airtable.js] Reset filters button not found');
  }
});

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

  // Card as a div, open modal on click
  const wrapper = document.createElement('div');
  wrapper.className = 'bento-card-wrapper';
  const card = document.createElement('div');
  card.className = 'bento-card';
  card.style.cursor = 'pointer';
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
  card.addEventListener('click', () => openPropertyModal(record.id));
  wrapper.appendChild(card);
  return wrapper;
}

// Modal logic
async function openPropertyModal(recordId) {
  const modal = document.getElementById('property-modal');
  const modalBody = document.getElementById('modal-body');
  if (!modal || !modalBody) return;
  // Show loading spinner
  modalBody.innerHTML = `<div class="loading" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; min-height: 120px; justify-content: center;"><div class="spinner" style="border: 4px solid #e2e8f0; border-top: 4px solid #2563eb; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite;"></div><span>Loading property...</span></div><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>`;
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.overflowY = 'auto';
  modal.style.padding = '2vw';
  document.body.style.overflow = 'hidden';
  try {
    const record = await fetchPropertyDetail(recordId);
    modalBody.innerHTML = renderModalPropertyDetail(record);
  } catch (err) {
    modalBody.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

function closePropertyModal() {
  const modal = document.getElementById('property-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Fetch property detail from Airtable
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

function renderModalPropertyDetail(record) {
  const fields = record.fields;
  const imageUrl = fields['Image']?.[0]?.url || 'https://via.placeholder.com/800x400?text=No+Image';
  const title = fields['Title'] || 'Untitled';
  const location = fields['Location'] || 'Unknown';
  const price = fields['Price'] ? `₹${fields['Price'].toLocaleString()}` : 'Price on request';
  const description = fields['Description'] || '';
  const type = fields['Type'] || '';
  const listingType = fields['ListingType'] || '';
  const area = fields['Area'] || '';
  const bedrooms = fields['Bedrooms'] || '';
  const bathrooms = fields['Bathrooms'] || '';
  const amenities = Array.isArray(fields['Amenities']) ? fields['Amenities'].join(', ') : (fields['Amenities'] || '');
  const status = fields['Status'] || '';
  const floor = fields['Floor'] || '';
  const age = fields['Age'] || '';
  const facing = fields['Facing'] || '';
  const parking = fields['Parking'] || '';
  const furnishing = fields['Furnishing'] || '';
  const whatsappNumber = '919860826918';
  const whatsappMsg = encodeURIComponent(`Hi, I'm interested in the property: ${title} (${location}) for ${price}`);
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${whatsappMsg}`;
  return `
    <style>
      @media (max-width: 900px) {
        .property-modal-content {
          max-width: 98vw !important;
          min-width: 0 !important;
          padding: 1vw !important;
        }
        .property-detail-image {
          max-height: 180px !important;
        }
      }
      @media (max-width: 600px) {
        .property-modal-content {
          max-width: 100vw !important;
          min-width: 0 !important;
          border-radius: 0 !important;
          padding: 0.5vw !important;
        }
        .property-detail-image {
          max-height: 120px !important;
        }
        .property-detail-title {
          font-size: 1.1rem !important;
        }
      }
      .property-detail-table table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 0.4rem;
        font-size: 1.05rem;
        color: #374151;
      }
      .property-detail-table td.label {
        font-weight: 700;
        color: #1E293B;
        min-width: 120px;
        padding-right: 0.5rem;
        text-align: right;
        vertical-align: top;
        font-family: 'Inter', Arial, sans-serif;
      }
      .property-detail-table td.colon {
        font-weight: 700;
        color: #64748b;
        width: 12px;
        text-align: center;
        vertical-align: top;
        font-family: 'Inter', Arial, sans-serif;
      }
      .property-detail-table td.value {
        font-weight: 400;
        color: #374151;
        padding-left: 0.5rem;
        font-family: 'Inter', Arial, sans-serif;
      }
    </style>
    <div class="property-modal-content" style="background:#fff; border-radius:1.25rem; max-width:700px; min-width:340px; width:100%; box-shadow:0 8px 32px rgba(30,41,59,0.18); overflow:auto; max-height:90vh;">
      <div class="property-detail-header">
        <img src="${imageUrl}" alt="${title}" class="property-detail-image" style="width:100%; max-height:320px; object-fit:cover; border-radius:1rem 1rem 0 0; background:#f3f4f6;" />
        <div class="property-detail-info" style="margin-top:1.5rem; padding: 0 1.5rem 1.5rem 1.5rem;">
          <div class="property-detail-title" style="font-size:1.5rem; font-weight:700; color:#1E293B;">${title}</div>
          <div class="property-detail-location" style="font-size:1.1rem; color:#2563eb; font-weight:500;">${location}</div>
          <div class="property-detail-price" style="font-size:1.2rem; color:#059669; font-weight:600;">${price}</div>
          <div class="property-detail-description" style="font-size:1.05rem; color:#64748b; margin-top:1rem;">${description}</div>
          <div class="property-detail-table" style="margin-top:1.5rem; overflow-x:auto;">
            <table>
              <tbody>
                ${type ? `<tr><td class='label'>Type</td><td class='colon'>:</td><td class='value'>${type}</td></tr>` : ''}
                ${listingType ? `<tr><td class='label'>Listing Type</td><td class='colon'>:</td><td class='value'>${listingType}</td></tr>` : ''}
                ${area ? `<tr><td class='label'>Area</td><td class='colon'>:</td><td class='value'>${area}</td></tr>` : ''}
                ${bedrooms ? `<tr><td class='label'>Bedrooms</td><td class='colon'>:</td><td class='value'>${bedrooms}</td></tr>` : ''}
                ${bathrooms ? `<tr><td class='label'>Bathrooms</td><td class='colon'>:</td><td class='value'>${bathrooms}</td></tr>` : ''}
                ${floor ? `<tr><td class='label'>Floor</td><td class='colon'>:</td><td class='value'>${floor}</td></tr>` : ''}
                ${age ? `<tr><td class='label'>Age</td><td class='colon'>:</td><td class='value'>${age}</td></tr>` : ''}
                ${facing ? `<tr><td class='label'>Facing</td><td class='colon'>:</td><td class='value'>${facing}</td></tr>` : ''}
                ${parking ? `<tr><td class='label'>Parking</td><td class='colon'>:</td><td class='value'>${parking}</td></tr>` : ''}
                ${furnishing ? `<tr><td class='label'>Furnishing</td><td class='colon'>:</td><td class='value'>${furnishing}</td></tr>` : ''}
                ${status ? `<tr><td class='label'>Status</td><td class='colon'>:</td><td class='value'>${status}</td></tr>` : ''}
                ${amenities ? `<tr><td class='label'>Amenities</td><td class='colon'>:</td><td class='value'>${amenities}</td></tr>` : ''}
              </tbody>
            </table>
          </div>
          <a href="${whatsappLink}" class="whatsapp-cta" target="_blank" rel="noopener" style="display:inline-block; margin-top:2rem; background:#25D366; color:#fff; padding:0.75rem 1.5rem; border-radius:8px; font-size:1.1rem; font-weight:600; text-decoration:none; transition:background 0.2s;">Enquire on WhatsApp</a>
        </div>
      </div>
    </div>
  `;
}

// Modal close event
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('modal-close');
  const modal = document.getElementById('property-modal');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', closePropertyModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePropertyModal();
    });
  }
});

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
