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
const pageQueryParams = new URLSearchParams(window.location.search);
let currentModalRecord = null;
const isAreasPage = document.body?.dataset?.page === 'areas';
let fixedAreaLocation = getInitialAreaFromContext();
let areaSelectHandlerAttached = false;

function toAreaSlug(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toTitleCase(value) {
  return value
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function normalizeAreaValue(value) {
  if (!value || typeof value !== 'string') return '';
  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch (e) {
    // Keep the original value if decoding fails.
  }
  decoded = decoded.replace(/\+/g, ' ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return toTitleCase(decoded);
}

function getAreaFromPath() {
  const path = window.location.pathname || '';
  const marker = 'areas.html/';
  const markerIndex = path.toLowerCase().indexOf(marker);
  if (markerIndex === -1) return '';
  const afterMarker = path.slice(markerIndex + marker.length);
  const areaSegment = afterMarker.split('/')[0] || '';
  if (!areaSegment) return '';
  return normalizeAreaValue(areaSegment);
}

function getInitialAreaFromContext() {
  const pathArea = getAreaFromPath();
  const queryArea = pageQueryParams.get('location') || pageQueryParams.get('area') || '';
  const bodyArea = document.body?.dataset?.area || '';
  return normalizeAreaValue(pathArea || queryArea || bodyArea);
}

function updateAreaUrl(location) {
  if (!isAreasPage || !location) return;
  const slug = toAreaSlug(location);
  if (!slug) return;

  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/areas\.html(?:\/[^/?#]*)?$/i, `areas.html/${slug}`);
  url.searchParams.delete('area');
  url.searchParams.delete('location');
  window.history.replaceState({}, '', url.toString());
}

function getAreaDescriptionForLocation(records, location) {
  if (!location) return '';
  const areaRecord = records.find(record => {
    const recordLocation = (record.fields?.['Location'] || '').trim().toLowerCase();
    return recordLocation === location.trim().toLowerCase();
  });
  if (!areaRecord) return '';
  const fields = areaRecord.fields || {};
  const candidates = [
    fields['Area Description'],
    fields['Location Description']
  ];
  return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}

function applyAreaPageContext(records) {
  if (!isAreasPage) return;

  const locationFilter = document.getElementById('filter-location');
  const areaLocationSelect = document.getElementById('area-location-select');
  const heading = document.getElementById('area-heading');
  const listingsHeading = document.getElementById('area-listings-heading');
  const description = document.getElementById('area-description');
  const availableLocations = [...new Set(
    records
      .map(record => (record.fields?.['Location'] || '').trim())
      .filter(Boolean)
  )];

  if (!fixedAreaLocation && availableLocations.length > 0) {
    fixedAreaLocation = availableLocations[0];
  }

  if (fixedAreaLocation) {
    const matchedLocation = availableLocations.find(
      location => location.toLowerCase() === fixedAreaLocation.toLowerCase()
    );
    if (matchedLocation) fixedAreaLocation = matchedLocation;
  }

  if (areaLocationSelect) {
    areaLocationSelect.innerHTML = '';
    availableLocations.forEach(location => {
      const option = document.createElement('option');
      option.value = location;
      option.textContent = location;
      areaLocationSelect.appendChild(option);
    });
    if (fixedAreaLocation) {
      areaLocationSelect.value = fixedAreaLocation;
    }

    if (!areaSelectHandlerAttached) {
      areaLocationSelect.addEventListener('change', () => {
        fixedAreaLocation = areaLocationSelect.value || '';
        updateAreaUrl(fixedAreaLocation);
        if (locationFilter) locationFilter.value = fixedAreaLocation;
        applyAreaPageContext(allListings);
        applyFiltersAndRender();
      });
      areaSelectHandlerAttached = true;
    }
  }

  if (locationFilter && fixedAreaLocation) {
    locationFilter.value = fixedAreaLocation;
    locationFilter.disabled = true;
  }

  if (heading) {
    heading.textContent = fixedAreaLocation
      ? `Flats in ${fixedAreaLocation}, Pune`
      : 'Flats in Pune';
  }

  if (listingsHeading) {
    listingsHeading.textContent = fixedAreaLocation
      ? `Latest Properties in ${fixedAreaLocation}`
      : 'Latest Properties';
  }

  if (description) {
    const dynamicDescription = getAreaDescriptionForLocation(records, fixedAreaLocation);
    description.textContent = dynamicDescription || '';
  }
}

function getPropertyTypeValue(fields) {
  return fields['Property Type'] || fields['Type'] || '';
}

function getOfferTypeValue(fields) {
  return fields['Offer Type'] || fields['ListingType'] || '';
}

function getKeywordQuery() {
  const keywordInput = document.getElementById('filter-keyword');
  return (keywordInput?.value || pageQueryParams.get('q') || '').trim().toLowerCase();
}

function populateSelectOptions(select, values, placeholder) {
  if (!select) return;

  select.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = placeholder;
  select.appendChild(defaultOption);

  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function hydrateFilterOptions(records) {
  const uniqueValues = (getter) => [...new Set(
    records
      .map(record => getter(record.fields || {}))
      .filter(value => typeof value === 'string' && value.trim())
  )].sort((a, b) => a.localeCompare(b));

  populateSelectOptions(document.getElementById('filter-location'), uniqueValues(fields => fields['Location'] || ''), 'All Locations');
  populateSelectOptions(document.getElementById('filter-type'), uniqueValues(getPropertyTypeValue), 'All Types');
  populateSelectOptions(document.getElementById('filter-listing-type'), uniqueValues(getOfferTypeValue), 'All');
}

function applyQueryParamsToFilters() {
  const location = fixedAreaLocation || pageQueryParams.get('location') || pageQueryParams.get('area') || '';
  const propertyType = pageQueryParams.get('propertyType') || pageQueryParams.get('type') || '';
  const offerType = pageQueryParams.get('offerType') || pageQueryParams.get('listingType') || '';
  const keyword = pageQueryParams.get('q') || '';

  const keywordFilter = document.getElementById('filter-keyword');
  const locationFilter = document.getElementById('filter-location');
  const typeFilter = document.getElementById('filter-type');
  const listingTypeFilter = document.getElementById('filter-listing-type');

  if (keywordFilter && keyword) keywordFilter.value = keyword;
  if (locationFilter && location) locationFilter.value = location;
  if (typeFilter && propertyType) typeFilter.value = propertyType;
  if (listingTypeFilter && offerType) listingTypeFilter.value = offerType;
}

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
    const records = [];
    let offset = '';

    do {
      const url = new URL(AIRTABLE_ENDPOINT);
      if (offset) url.searchParams.set('offset', offset);

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch listings.');
      }

      const data = await response.json();
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    allListings = records;
    if (allListings.length === 0) {
      showError('No properties found from Airtable.');
    } else {
      hydrateFilterOptions(allListings);
      applyQueryParamsToFilters();
      applyAreaPageContext(allListings);
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
    hydrateFilterOptions(allListings);
    applyQueryParamsToFilters();
    applyAreaPageContext(allListings);
    applyFiltersAndRender();
  }
}

// Filtering and sorting logic

function applyFiltersAndRender() {
  let filtered = [...allListings];

  // Get filter values
  const selectedLocation = document.getElementById('filter-location')?.value || '';
  const location = fixedAreaLocation || selectedLocation;
  const type = document.getElementById('filter-type')?.value || '';
  const listingType = document.getElementById('filter-listing-type')?.value || '';
  const minPrice = parseInt(document.getElementById('filter-min-price')?.value, 10);
  const maxPrice = parseInt(document.getElementById('filter-max-price')?.value, 10);
  const sort = document.getElementById('sort-price')?.value || 'default';
  const keywordQuery = getKeywordQuery();

  filtered = filtered.filter(record => {
    const f = record.fields;
    let pass = true;
    if (location && f['Location'] !== location) pass = false;
    if (type && getPropertyTypeValue(f) !== type) pass = false;
    if (listingType && getOfferTypeValue(f) !== listingType) pass = false;
    const price = Number(f['Price']) || 0;
    if (!isNaN(minPrice) && minPrice > 0 && price < minPrice) pass = false;
    if (!isNaN(maxPrice) && maxPrice > 0 && price > maxPrice) pass = false;
    if (keywordQuery) {
      const searchableText = [
        f['Title'],
        f['Location'],
        f['Description'],
        getPropertyTypeValue(f),
        getOfferTypeValue(f)
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchableText.includes(keywordQuery)) pass = false;
    }
    return pass;
  });

  if (sort === 'recent') {
    filtered.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
  } else if (sort === 'price-asc') {
    filtered.sort((a, b) => (Number(a.fields?.['Price']) || 0) - (Number(b.fields?.['Price']) || 0));
  } else if (sort === 'price-desc') {
    filtered.sort((a, b) => (Number(b.fields?.['Price']) || 0) - (Number(a.fields?.['Price']) || 0));
  }

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

  const keywordFilter = document.getElementById('filter-keyword');
  if (keywordFilter) {
    keywordFilter.addEventListener('input', applyFiltersAndRender);
  }

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
      const keywordInput = document.getElementById('filter-keyword');
      const locationFilter = document.getElementById('filter-location');
      if (locationFilter) locationFilter.value = fixedAreaLocation || '';
      document.getElementById('filter-type').value = '';
      document.getElementById('filter-listing-type').value = '';
      if (keywordInput) keywordInput.value = '';
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
  const listingType = getOfferTypeValue(fields) || 'Property';
  const shortDescription = fields['Short Description'] || fields['Description'] || '';
  const description = shortDescription ? truncateText(shortDescription, 110) : '';

  // Card as a div, open modal on click
  const wrapper = document.createElement('div');
  wrapper.className = 'bento-card-wrapper';
  const card = document.createElement('div');
  card.className = 'bento-card';
  card.style.cursor = 'pointer';
  card.innerHTML = `
    <div class="listing-image-container">
      <img class="property-image" src="${imageUrl}" alt="${title}" loading="lazy" />
      <div class="bento-badge">${listingType}</div>
    </div>
    <div class="bento-content" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
      <h3 class="property-title">${title}</h3>
      <div class="property-location">${location}</div>
      <div class="property-description">${description}</div>
      <div class="property-price">${price}</div>
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
  modal.style.overflowX = 'hidden';
  modal.style.padding = '2vw';
  modal.style.scrollbarWidth = 'none';
  modal.style.msOverflowStyle = 'none';
  document.body.style.overflow = 'hidden';
  try {
    const record = await fetchPropertyDetail(recordId);
    currentModalRecord = record;
    modalBody.innerHTML = renderModalPropertyDetail(record);
  } catch (err) {
    modalBody.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

function closePropertyModal() {
  const modal = document.getElementById('property-modal');
  if (modal) modal.style.display = 'none';
  currentModalRecord = null;
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
  const rootStyles = getComputedStyle(document.documentElement);
  const pageBackground = (rootStyles.getPropertyValue('--background-light') || '#f7fafc').trim();
  const panelBackground = (rootStyles.getPropertyValue('--white') || '#ffffff').trim();
  const titleColor = (rootStyles.getPropertyValue('--dark-navy') || '#1e293b').trim();
  const textColor = (rootStyles.getPropertyValue('--slate-gray') || '#64748b').trim();
  const lightBorder = (rootStyles.getPropertyValue('--light-gray') || '#e2e8f0').trim();
  const primaryColor = (rootStyles.getPropertyValue('--primary-blue') || '#9A2A2A').trim();
  const accentColor = (rootStyles.getPropertyValue('--accent-blue') || '#E74C3C').trim();
  const isDarkMode = document.documentElement.classList.contains('dark-mode');
  const fields = record.fields;
  const imageUrl = fields['Image']?.[0]?.url || 'https://via.placeholder.com/800x400?text=No+Image';
  const title = fields['Title'] || 'Untitled';
  const location = fields['Location'] || 'Unknown';
  const price = fields['Price'] ? `₹${fields['Price'].toLocaleString()}` : 'Price on request';
  const description = fields['Description'] || '';
  const type = fields['Property Type'] || fields['Type'] || '';
  const listingType = fields['Offer Type'] || fields['ListingType'] || '';
  const area = fields['Area'] || fields['Size (sqft)'] ? `${fields['Area'] || fields['Size (sqft)']}${fields['Size (sqft)'] && !fields['Area'] ? ' sqft' : ''}` : '';
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
  const theme = isDarkMode ? {
    modalBg: pageBackground,
    panelBg: panelBackground,
    panelBorder: 'rgba(148,163,184,0.12)',
    title: titleColor,
    text: '#cbd5e1',
    mutedText: '#a8b6c9',
    price: '#34d399',
    badgeBg: primaryColor,
    pillBg: 'rgba(148,163,184,0.09)',
    pillText: titleColor,
    accent: accentColor,
    shadow: '0 24px 60px rgba(15,23,42,0.34)',
    typeBadgeBg: 'rgba(148,163,184,0.12)',
    typeBadgeText: '#e2e8f0',
    amenitiesText: '#cbd5e1'
  } : {
    modalBg: '#ffffff',
    panelBg: '#ffffff',
    panelBorder: 'rgba(15,23,42,0.08)',
    title: titleColor,
    text: textColor,
    mutedText: textColor,
    price: '#059669',
    badgeBg: primaryColor,
    pillBg: '#f8fafc',
    pillText: titleColor,
    accent: primaryColor,
    shadow: '0 24px 60px rgba(15,23,42,0.14)',
    typeBadgeBg: '#f1f5f9',
    typeBadgeText: titleColor,
    amenitiesText: textColor
  };
  const details = [
    { label: 'Type', value: type },
    { label: 'Listing Type', value: listingType },
    { label: 'Area', value: area },
    { label: 'Bedrooms', value: bedrooms },
    { label: 'Bathrooms', value: bathrooms },
    { label: 'Floor', value: floor },
    { label: 'Age', value: age },
    { label: 'Facing', value: facing },
    { label: 'Parking', value: parking },
    { label: 'Furnishing', value: furnishing }
  ].filter(detail => detail.value);

  const detailCards = details.map(detail => `
    <div class="property-detail-stat-card">
      <div class="property-detail-stat-label">${detail.label}</div>
      <div class="property-detail-stat-value">${detail.value}</div>
    </div>
  `).join('');

  return `
    <style>
      @media (max-width: 900px) {
        .property-modal-content {
          max-width: 98vw !important;
          min-width: 0 !important;
        }
        .property-detail-image {
          max-height: 220px !important;
        }
        .property-detail-body {
          grid-template-columns: 1fr !important;
        }
        .property-detail-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
      }
      @media (max-width: 600px) {
        .property-modal-content {
          max-width: 100vw !important;
          min-width: 0 !important;
          border-radius: 18px !important;
        }
        .property-detail-image {
          max-height: 180px !important;
        }
        .property-detail-title {
          font-size: 1.25rem !important;
        }
        .property-detail-stats {
          grid-template-columns: 1fr !important;
        }
      }
      .property-detail-stat-card {
        background: ${theme.panelBg};
        border: 1px solid ${theme.panelBorder};
        border-radius: 18px;
        padding: 1rem 1.05rem;
        min-height: 112px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
      }
      .property-detail-stat-label {
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: ${theme.accent};
        margin-bottom: 0.5rem;
      }
      .property-detail-stat-value {
        font-size: 1.05rem;
        font-weight: 600;
        line-height: 1.55;
        color: ${theme.title};
      }
      #property-modal {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      #property-modal::-webkit-scrollbar {
        display: none;
      }
      .property-modal-content {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .property-modal-content::-webkit-scrollbar {
        display: none;
      }
      .modal-whatsapp-float {
        position: absolute;
        left: 1.35rem;
        bottom: 1.35rem;
        display: inline-flex;
        align-items: center;
        text-decoration: none;
        z-index: 3;
      }
      .modal-whatsapp-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 58px;
        height: 58px;
        border-radius: 999px;
        background: #25d366;
        color: #fff;
        box-shadow: 0 12px 24px rgba(37, 211, 102, 0.28);
        transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      }
      .modal-whatsapp-float:hover .modal-whatsapp-icon {
        transform: translateY(-2px);
        box-shadow: 0 14px 28px rgba(37, 211, 102, 0.34);
        background: #1ebd5a;
      }
      @media (max-width: 600px) {
        .modal-whatsapp-icon {
          width: 54px;
          height: 54px;
        }
        .modal-whatsapp-float { left: 1rem; bottom: 1rem; }
      }
    </style>
    <div class="property-modal-content" style="background:${theme.modalBg}; border-radius:22px; max-width:960px; min-width:340px; width:100%; box-shadow:${theme.shadow}; overflow-y:auto; overflow-x:hidden; max-height:90vh; border:1px solid ${theme.panelBorder};">
      <img src="${imageUrl}" alt="${title}" class="property-detail-image" style="width:100%; max-height:320px; object-fit:cover; display:block; background:${panelBackground};" />
      <div class="property-detail-body" style="display:grid; grid-template-columns: 1.1fr 0.9fr; gap:1.25rem; padding:1.35rem;">
        <div class="property-detail-main" style="position:relative; background:${theme.panelBg}; border:1px solid ${theme.panelBorder}; border-radius:18px; padding:1.35rem; padding-bottom:5.2rem;">
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; margin-bottom:0.75rem;">
            <span style="display:inline-flex; align-items:center; justify-content:center; min-height:32px; padding:0.35rem 0.8rem; border-radius:999px; background:${theme.badgeBg}; color:#fff; font-size:0.85rem; font-weight:700;">${listingType || 'Property'}</span>
            ${type ? `<span style="display:inline-flex; align-items:center; justify-content:center; min-height:32px; padding:0.35rem 0.8rem; border-radius:999px; background:${theme.typeBadgeBg}; color:${theme.typeBadgeText}; font-size:0.85rem; font-weight:600;">${type}</span>` : ''}
          </div>
          <div class="property-detail-title" style="font-size:2rem; font-weight:700; color:${theme.title}; line-height:1.18; margin-bottom:0.6rem;">${title}</div>
          <div class="property-detail-location" style="font-size:1.02rem; color:${theme.text}; font-weight:500; margin-bottom:0.6rem;">${location}</div>
          <div class="property-detail-price" style="font-size:1.55rem; color:${theme.price}; font-weight:700; margin-bottom:0.75rem;">${price}</div>
          ${status ? `<div style="display:inline-flex; align-items:center; gap:0.55rem; margin-bottom:1rem; padding:0.45rem 0.8rem; border-radius:12px; background:${theme.pillBg}; border:1px solid ${theme.panelBorder};"><span style="font-size:0.76rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${theme.accent};">Status</span><span style="font-size:0.96rem; font-weight:600; color:${theme.pillText};">${status}</span></div>` : ''}
          <div class="property-detail-description" style="font-size:1rem; color:${theme.mutedText}; line-height:1.8;">${description}</div>
          <a href="${whatsappLink}" class="whatsapp-cta modal-whatsapp-float" target="_blank" rel="noopener" aria-label="Click to enquire on WhatsApp">
            <span class="modal-whatsapp-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.8 0-65.7-10.8-94.2-30.6l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5c-.1 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>
            </span>
          </a>
        </div>
        <div class="property-detail-side" style="display:flex; flex-direction:column; gap:1rem;">
          <div class="property-detail-stats" style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0.9rem;">
            ${detailCards}
          </div>
          ${amenities ? `
            <div class="property-detail-amenities" style="background:${theme.panelBg}; border:1px solid ${theme.panelBorder}; border-radius:18px; padding:1.1rem 1.15rem;">
              <div style="font-size:0.82rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${theme.accent}; margin-bottom:0.7rem;">Amenities</div>
              <div style="font-size:0.98rem; line-height:1.8; color:${theme.amenitiesText};">${amenities}</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// Modal close event
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('modal-close');
  const modal = document.getElementById('property-modal');
  const themeToggle = document.getElementById('theme-toggle');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', closePropertyModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePropertyModal();
    });
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const modalBody = document.getElementById('modal-body');
      const modalVisible = modal && modal.style.display === 'flex';
      if (modalVisible && modalBody && currentModalRecord) {
        requestAnimationFrame(() => {
          modalBody.innerHTML = renderModalPropertyDetail(currentModalRecord);
        });
      }
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
