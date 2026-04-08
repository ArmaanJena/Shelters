// airtable.js
// Listings and area UI powered by static JSON generated at build-time.
const LISTINGS_STATIC_ENDPOINT = '/data/listings.json';
const AREA_QUESTIONS_STATIC_ENDPOINT = '/data/area-questions.json';
const LISTINGS_CACHE_KEY = 'listings_cache_v6';
const LISTINGS_CACHE_TTL = 15 * 60 * 1000;
const AREA_QUESTIONS_CACHE_KEY = 'area_questions_cache_v2';
const AREA_QUESTIONS_CACHE_TTL = 10 * 60 * 1000;
const LAST_VIEWED_STORAGE_KEY = 'listings_last_viewed_v1';
const LISTING_IMAGE_REFRESH_CACHE_KEY = 'listings_image_refresh_v1';
const LISTING_IMAGE_REFRESH_TTL = 6 * 60 * 60 * 1000;
const JSON_FETCH_TIMEOUT_MS = 15000;
const SLOW_LOAD_NOTICE_MS = 2500;
const CARD_IMAGE_FALLBACK =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20800%20500%22%3E%3Crect%20width%3D%22800%22%20height%3D%22500%22%20fill%3D%22%23cbd5e1%22/%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%23334155%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2232%22%3EImage%20Unavailable%3C/text%3E%3C/svg%3E';

const pageQueryParams = new URLSearchParams(window.location.search);
let currentModalRecord = null;
const isAreasPage = document.body?.dataset?.page === 'areas';
const isNewLaunchesPage = document.body?.dataset?.page === 'new-launches';
const NEW_LISTING_WINDOW_DAYS =
  Number.parseInt(document.body?.dataset?.newListingWindowDays || '7', 10) || 7;
const LISTINGS_PER_PAGE = 48;
let fixedAreaLocation = getInitialAreaFromContext();
let newLaunchRecordIds = new Set();
let areaQuestionsRecords = [];
let currentListingsPage = 1;
let listingsSlowLoadTimer = null;
const DEMO_JSON_FAILURE = pageQueryParams.get('demo') === 'json-failure';
const DEMO_EMPTY_DATASET = pageQueryParams.get('demo') === 'empty-dataset';
const DEMO_MISSING_FIELDS = pageQueryParams.get('demo') === 'missing-fields';
const DEMO_SLOW_LOAD = pageQueryParams.get('demo') === 'slow-load';

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function classifyFetchFailure(error) {
  const message = (error?.message || '').toString();
  if (error?.name === 'AbortError') {
    return `Timeout while loading JSON (${JSON_FETCH_TIMEOUT_MS}ms).`;
  }
  if (error instanceof TypeError) {
    return 'Network failure while loading JSON.';
  }
  if (/invalid response|invalid json|unexpected token|json/i.test(message)) {
    return `Invalid response: ${message}`;
  }
  return message || 'Unknown JSON fetch failure.';
}

function clearListingsSlowLoadNotice() {
  if (listingsSlowLoadTimer) {
    window.clearTimeout(listingsSlowLoadTimer);
    listingsSlowLoadTimer = null;
  }
}

async function fetchJsonWithTimeout(endpoint, label) {
  if (DEMO_JSON_FAILURE && /listings\.json/i.test(endpoint)) {
    throw new Error('Simulated JSON failure for fallback validation.');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), JSON_FETCH_TIMEOUT_MS);

  try {
    if (DEMO_SLOW_LOAD && /listings\.json/i.test(endpoint)) {
      await delay(SLOW_LOAD_NOTICE_MS + 1800);
    }

    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Invalid response (${response.status}) for ${label}.`);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error(`Invalid JSON payload for ${label}.`);
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getLastViewedMap() {
  const cachedRaw = localStorage.getItem(LAST_VIEWED_STORAGE_KEY);
  if (!cachedRaw) return {};
  try {
    const parsed = JSON.parse(cachedRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    console.warn('Invalid last viewed cache payload', error);
  }
  return {};
}

function setLastViewedMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    localStorage.removeItem(LAST_VIEWED_STORAGE_KEY);
    return;
  }
  localStorage.setItem(LAST_VIEWED_STORAGE_KEY, JSON.stringify(map));
}

function markListingAsViewed(recordId) {
  if (!recordId) return;
  const map = getLastViewedMap();
  map[recordId] = Date.now();
  setLastViewedMap(map);
}

function getListingImageRefreshCache() {
  const cachedRaw = localStorage.getItem(LISTING_IMAGE_REFRESH_CACHE_KEY);
  if (!cachedRaw) return {};
  try {
    const parsed = JSON.parse(cachedRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    console.warn('Invalid listing image refresh cache payload', error);
  }
  return {};
}

function setListingImageRefreshCache(cache) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
    localStorage.removeItem(LISTING_IMAGE_REFRESH_CACHE_KEY);
    return;
  }
  localStorage.setItem(LISTING_IMAGE_REFRESH_CACHE_KEY, JSON.stringify(cache));
}

function normalizeImageAttachments(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image) => image && typeof image === 'object')
    .map((image) => ({
      id: image.id || '',
      width: image.width || null,
      height: image.height || null,
      url: image.url || '',
      filename: image.filename || '',
      size: image.size || null,
      type: image.type || '',
      thumbnails: image.thumbnails || {}
    }))
    .filter((image) => typeof image.url === 'string' && image.url.trim());
}

function extractAirtableUrlExpiryMs(url) {
  const value = (url || '').toString();
  if (!value) return null;
  const match =
    value.match(/\/v\d+\/u\/\d+\/\d+\/(\d{10,13})\//i) || value.match(/\/(\d{13})\//);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw < 1e12 ? raw * 1000 : raw;
}

function isLikelyExpiredAirtableImageUrl(url) {
  const value = (url || '').toString().trim();
  if (!value || !/airtableusercontent\.com/i.test(value)) return false;
  const expiryMs = extractAirtableUrlExpiryMs(value);
  if (!Number.isFinite(expiryMs)) return false;
  return Date.now() >= expiryMs - 5 * 60 * 1000;
}

function shouldRefreshRecordImages(record) {
  const images = record?.fields?.Image;
  if (!Array.isArray(images) || images.length === 0) return false;
  return images.some((image) => {
    const candidateUrl =
      image?.thumbnails?.large?.url || image?.thumbnails?.full?.url || image?.url || '';
    return isLikelyExpiredAirtableImageUrl(candidateUrl);
  });
}

function hasAirtableHostedImages(record) {
  const images = record?.fields?.Image;
  if (!Array.isArray(images) || images.length === 0) return false;
  return images.some((image) => {
    const candidateUrl =
      image?.thumbnails?.large?.url || image?.thumbnails?.full?.url || image?.url || '';
    return /airtableusercontent\.com/i.test(candidateUrl);
  });
}

function getCachedRefreshedImages(recordId) {
  if (!recordId) return [];
  const cache = getListingImageRefreshCache();
  const entry = cache[recordId];
  if (!entry || !Array.isArray(entry.images)) return [];
  if (Date.now() - Number(entry.ts || 0) > LISTING_IMAGE_REFRESH_TTL) return [];
  const normalized = normalizeImageAttachments(entry.images);
  if (
    normalized.some((image) => {
      const candidateUrl =
        image?.thumbnails?.large?.url || image?.thumbnails?.full?.url || image?.url || '';
      return isLikelyExpiredAirtableImageUrl(candidateUrl);
    })
  ) {
    return [];
  }
  return normalized;
}

function cacheRefreshedImages(recordId, images) {
  if (!recordId) return;
  const normalized = normalizeImageAttachments(images);
  if (normalized.length === 0) return;
  const cache = getListingImageRefreshCache();
  cache[recordId] = { ts: Date.now(), images: normalized };
  setListingImageRefreshCache(cache);
}

function cloneRecordWithImages(record, images) {
  const normalizedImages = normalizeImageAttachments(images);
  if (!record || normalizedImages.length === 0) return record;
  return {
    ...record,
    fields: {
      ...(record.fields || {}),
      Image: normalizedImages
    }
  };
}

async function fetchFreshRecordFromStatic(recordId) {
  if (!recordId) return null;
  let payload;
  try {
    payload = await fetchJsonWithTimeout(
      `${LISTINGS_STATIC_ENDPOINT}?ts=${Date.now()}`,
      'listings refresh'
    );
  } catch (error) {
    return null;
  }
  const records = Array.isArray(payload?.records) ? payload.records : Array.isArray(payload) ? payload : [];
  return records.find((item) => item.id === recordId) || null;
}

async function ensureRecordHasFreshImages(record) {
  if (!record || !shouldRefreshRecordImages(record)) return record;

  const cachedImages = getCachedRefreshedImages(record.id);
  if (cachedImages.length > 0) {
    return cloneRecordWithImages(record, cachedImages);
  }

  try {
    const staticRecord = await fetchFreshRecordFromStatic(record.id);
    const staticImages = normalizeImageAttachments(staticRecord?.fields?.Image);
    if (staticImages.length > 0) {
      cacheRefreshedImages(record.id, staticImages);
      return cloneRecordWithImages(record, staticImages);
    }
  } catch (error) {
    console.warn('Unable to refresh listing images from static listings', error);
  }

  return record;
}

function isRecentlyAdded(createdTime, days = 7) {
  const createdAt = new Date(createdTime || 0).getTime();
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  return Date.now() - createdAt <= days * 24 * 60 * 60 * 1000;
}

function getListingsContainer() {
  return document.getElementById('property-listings');
}

function getSiteRootUrl() {
  const url = new URL(window.location.href);
  const path = url.pathname || '/';

  if (path.includes('/areas/')) {
    url.pathname = `${path.split('/areas/')[0]}/`;
  } else if (path.includes('/areas.html/')) {
    url.pathname = `${path.split('/areas.html/')[0]}/`;
  } else if (path.includes('/new-launches/')) {
    url.pathname = `${path.split('/new-launches/')[0]}/`;
  } else if (path.includes('/listings/')) {
    url.pathname = `${path.split('/listings/')[0]}/`;
  } else if (path.includes('/property-detail/')) {
    url.pathname = `${path.split('/property-detail/')[0]}/`;
  } else {
    url.pathname = path.replace(/[^/]*$/, '');
  }

  url.search = '';
  url.hash = '';
  return url.toString();
}

function resolveImageUrl(url) {
  const value = (url || '').toString().trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;

  const normalized = value.startsWith('/') ? value.slice(1) : value;
  try {
    return new URL(normalized, getSiteRootUrl()).toString();
  } catch (error) {
    return value;
  }
}

function getAttachmentImageSources(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return { card: '', full: '' };
  }

  const small = resolveImageUrl(attachment?.thumbnails?.small?.url);
  const large = resolveImageUrl(attachment?.thumbnails?.large?.url);
  const full = resolveImageUrl(attachment?.url);

  return {
    // Prefer optimized thumbnail for list cards for faster rendering.
    card: large || small || full,
    full: full || large || small
  };
}

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
  const match = path.match(/\/areas(?:\.html)?\/([^/?#]+)/i);
  const areaSegment = match?.[1] || '';
  if (!areaSegment) return '';
  return normalizeAreaValue(areaSegment);
}

function getAreasPageBasePath() {
  const path = window.location.pathname || '/';

  if (/\/areas\.html\/?$/i.test(path)) {
    return path.replace(/\/+$/, '');
  }

  if (/\/areas\/?$/i.test(path)) {
    return path.endsWith('/') ? path : `${path}/`;
  }

  if (/\.html$/i.test(path)) {
    return path.replace(/[^/]+$/, 'areas.html');
  }

  return path.replace(/[^/]*$/, 'areas/');
}

function buildAreasPageUrl(location) {
  const url = new URL(window.location.href);
  url.pathname = getAreasPageBasePath();
  url.search = '';
  url.hash = '';

  if (location) {
    url.searchParams.set('area', toAreaSlug(location));
  }

  return url.toString();
}

function getInitialAreaFromContext() {
  const pathArea = getAreaFromPath();
  const queryArea = pageQueryParams.get('location') || pageQueryParams.get('area') || '';
  const bodyArea = document.body?.dataset?.area || '';
  return normalizeAreaValue(pathArea || queryArea || bodyArea);
}

function updateAreaUrl(location) {
  if (!isAreasPage || !location) return;
  window.history.replaceState({}, '', buildAreasPageUrl(location));
}

function getAreaQuestionsCache() {
  const cachedRaw = localStorage.getItem(AREA_QUESTIONS_CACHE_KEY);
  if (!cachedRaw) return null;
  try {
    const cached = JSON.parse(cachedRaw);
    if (
      Date.now() - cached.ts < AREA_QUESTIONS_CACHE_TTL &&
      Array.isArray(cached.records)
    ) {
      return cached.records;
    }
  } catch (error) {
    console.warn('Invalid area questions cache payload', error);
  }
  return null;
}

function setAreaQuestionsCache(records) {
  if (!Array.isArray(records)) {
    localStorage.removeItem(AREA_QUESTIONS_CACHE_KEY);
    return;
  }
  localStorage.setItem(AREA_QUESTIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), records }));
}

async function fetchAreaQuestionsRecords() {
  if (!isAreasPage) return [];
  if (areaQuestionsRecords.length > 0) return areaQuestionsRecords;

  const cached = getAreaQuestionsCache();
  if (cached) {
    areaQuestionsRecords = cached;
    return areaQuestionsRecords;
  }

  const data = await fetchJsonWithTimeout(
    `${AREA_QUESTIONS_STATIC_ENDPOINT}?ts=${Date.now()}`,
    'area questions'
  );
  const records = Array.isArray(data?.records) ? data.records : Array.isArray(data) ? data : [];

  areaQuestionsRecords = records;
  setAreaQuestionsCache(records);
  return records;
}

function buildAreaQuestionPairs(fields) {
  const pairs = [];
  const questionKeys = Object.keys(fields || {})
    .filter((key) => /^Question\s*\d+/i.test(key))
    .sort((a, b) => {
      const aNum = Number(a.match(/\d+/)?.[0] || 0);
      const bNum = Number(b.match(/\d+/)?.[0] || 0);
      return aNum - bNum;
    });

  questionKeys.forEach((questionKey) => {
    const questionIndex = questionKey.match(/\d+/)?.[0];
    const answerKey = questionIndex ? `Answer ${questionIndex}` : '';
    const questionText = (fields?.[questionKey] || '').toString().trim();
    const answerText = (fields?.[answerKey] || '').toString().trim();
    if (questionText && answerText) {
      pairs.push({ question: questionText, answer: answerText });
    }
  });

  return pairs;
}

function getAreaQuestionsContentForLocation(location) {
  if (!location) return { description: '', questions: [] };
  const normalizedLocation = normalizeAreaValue(location).toLowerCase();
  const matchedRecord = areaQuestionsRecords.find((record) => {
    const areaName = normalizeAreaValue(record.fields?.['Area Name'] || '').toLowerCase();
    const locationName = normalizeAreaValue(record.fields?.['Location'] || '').toLowerCase();
    return areaName === normalizedLocation || locationName === normalizedLocation;
  });

  if (!matchedRecord) {
    return { description: '', questions: [] };
  }

  const fields = matchedRecord.fields || {};
  return {
    description: (fields['Area Description'] || '').toString().trim(),
    questions: buildAreaQuestionPairs(fields)
  };
}

function renderAreaQuestionsGrid(questions) {
  const qaGrid = document.getElementById('area-qa-grid');
  if (!qaGrid) return;

  if (!Array.isArray(questions) || questions.length === 0) {
    qaGrid.innerHTML = `
      <article class="placeholder-card">
        <h4>Area Q&A coming soon</h4>
        <p>We are updating location-specific questions for this area.</p>
      </article>
    `;
    return;
  }

  qaGrid.innerHTML = questions
    .map(
      (item) => `
        <article class="placeholder-card">
          <h4>${escapeHtml(item.question)}</h4>
          <p>${escapeHtml(item.answer)}</p>
        </article>
      `
    )
    .join('');
}

function escapeHtml(value) {
  return (value || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAreaCardDescription(location) {
  const fallback = `Explore properties, trends, and neighbourhood insights in ${location}.`;
  const description = (getAreaQuestionsContentForLocation(location).description || fallback)
    .toString()
    .replace(/\s+/g, ' ')
    .trim();
  if (description.length <= 190) return description;
  return `${description.slice(0, 187)}...`;
}

function toSafeDisplayText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = value.toString().trim();
  if (!text || text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') return fallback;
  return text;
}

function formatDisplayPrice(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return `₹${numeric.toLocaleString('en-IN')}`;
  }
  return 'Price on request';
}

async function hydrateAreaInsights(location) {
  if (!isAreasPage) return;
  const descriptionEl = document.getElementById('area-description');

  try {
    await fetchAreaQuestionsRecords();
    const content = getAreaQuestionsContentForLocation(location);

    if (descriptionEl) {
      descriptionEl.textContent =
        content.description || 'Area details are being updated. Please check back soon.';
    }
    renderAreaQuestionsGrid(content.questions);
  } catch (error) {
    console.error('Failed to hydrate area insights:', error);
    if (descriptionEl) {
      descriptionEl.textContent = 'Unable to load area details right now.';
    }
    renderAreaQuestionsGrid([]);
  }
}

function applyAreaPageContext(records) {
  if (!isAreasPage) return;

  const locationFilter = document.getElementById('filter-location');
  const areaLocationGrid = document.getElementById('area-location-grid');
  const heading = document.getElementById('area-heading');
  const listingsHeading = document.getElementById('area-listings-heading');
  const description = document.getElementById('area-description');
  const availableLocations = [...new Set(
    records
      .map(record => (record.fields?.['Location'] || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  if (fixedAreaLocation) {
    const matchedLocation = availableLocations.find(
      location => location.toLowerCase() === fixedAreaLocation.toLowerCase()
    );
    fixedAreaLocation = matchedLocation || '';
  }

  if (areaLocationGrid) {
    areaLocationGrid.innerHTML = '';
    availableLocations.forEach((location) => {
      const card = document.createElement('a');
      card.className = `area-location-card${location === fixedAreaLocation ? ' is-active' : ''}`;
      card.href = `./?area=${encodeURIComponent(toAreaSlug(location))}`;
      card.setAttribute('aria-label', `View properties in ${location}`);
      card.dataset.area = location;
      const locationDescription = getAreaCardDescription(location);
      card.innerHTML = `
        <h3>${escapeHtml(location)}</h3>
        <p>${escapeHtml(locationDescription)}</p>
      `;
      card.addEventListener('click', (event) => {
        event.preventDefault();
        fixedAreaLocation = location;
        updateAreaUrl(fixedAreaLocation);
        if (locationFilter) locationFilter.value = fixedAreaLocation;
        applyAreaPageContext(allListings);
        applyFiltersAndRender();
      });
      areaLocationGrid.appendChild(card);
    });
  }

  if (locationFilter) {
    locationFilter.value = fixedAreaLocation || '';
    locationFilter.disabled = true;
  }

  const hasAreaSelection = Boolean(fixedAreaLocation);
  const listingsSection = document.getElementById('area-listings-section');
  const qaSection = document.getElementById('area-qa-section');

  if (listingsSection) {
    listingsSection.classList.toggle('area-filter-hidden', !hasAreaSelection);
  }
  if (qaSection) {
    qaSection.classList.toggle('area-filter-hidden', !hasAreaSelection);
  }

  if (heading) {
    heading.textContent = 'Explore Our Featured Areas';
  }

  if (listingsHeading) {
    listingsHeading.textContent = fixedAreaLocation
      ? `Latest Properties in ${fixedAreaLocation}`
      : 'Latest Properties';
  }

  if (description) {
    if (hasAreaSelection) {
      description.textContent = 'Loading area details...';
      description.classList.remove('area-filter-hidden');
    } else {
      description.textContent = '';
      description.classList.add('area-filter-hidden');
    }
  }

  if (hasAreaSelection) {
    hydrateAreaInsights(fixedAreaLocation);
  }
}

function getPropertyTypeValue(fields) {
  return fields['Property Type'] || fields['Type'] || '';
}

function getOfferTypeValue(fields) {
  return fields['Offer Type'] || fields['ListingType'] || '';
}

function computeNewLaunchRecordIds(records) {
  if (!Array.isArray(records) || records.length === 0) return new Set();
  const launchRecords = records.filter((record) =>
    isRecentlyAdded(record?.createdTime, NEW_LISTING_WINDOW_DAYS)
  );
  return new Set(launchRecords.map((record) => record.id).filter(Boolean));
}

function ensureNewLaunchFilterOption() {
  if (!isNewLaunchesPage) return;
  const listingTypeFilter = document.getElementById('filter-listing-type');
  if (!listingTypeFilter) return;

  const existingOption = listingTypeFilter.querySelector('option[value="__new_launch__"]');
  if (!existingOption) {
    const option = document.createElement('option');
    option.value = '__new_launch__';
    option.textContent = 'New';
    listingTypeFilter.insertBefore(option, listingTypeFilter.firstChild);
  }

  if (!listingTypeFilter.value) {
    listingTypeFilter.value = '__new_launch__';
  }
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
  ensureNewLaunchFilterOption();
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
  if (isNewLaunchesPage && listingTypeFilter && !offerType) listingTypeFilter.value = '__new_launch__';
}

function showLoading() {
  const listingsContainer = getListingsContainer();
  if (!listingsContainer) return;
  clearListingsSlowLoadNotice();

  listingsContainer.innerHTML = `
    <div class="loading" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; min-height: 120px; justify-content: center;">
      <div class="spinner" style="border: 4px solid #e2e8f0; border-top: 4px solid #2563eb; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite;"></div>
      <span id="listings-loading-status">Loading properties...</span>
    </div>
    <style>
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;

  listingsSlowLoadTimer = window.setTimeout(() => {
    const statusNode = document.getElementById('listings-loading-status');
    if (statusNode) {
      statusNode.textContent = 'Still loading... JSON response is slower than usual.';
    }
  }, SLOW_LOAD_NOTICE_MS);
}

function showError(message) {
  const listingsContainer = getListingsContainer();
  if (!listingsContainer) return;
  clearListingsSlowLoadNotice();
  listingsContainer.innerHTML = `<div class="error">${
    message || 'Content temporarily unavailable. Please try again.'
  }</div>`;
}


// Store all fetched listings for client-side filtering/sorting
let allListings = [];

function getListingsCache() {
  const cachedRaw = localStorage.getItem(LISTINGS_CACHE_KEY);
  if (!cachedRaw) return null;
  try {
    const cached = JSON.parse(cachedRaw);
    if (
      Date.now() - cached.ts < LISTINGS_CACHE_TTL &&
      Array.isArray(cached.records) &&
      cached.records.length > 0
    ) {
      return cached.records;
    }
  } catch (error) {
    console.warn('Invalid listings cache payload', error);
  }
  return null;
}

function setListingsCache(records) {
  if (!Array.isArray(records) || records.length === 0) {
    localStorage.removeItem(LISTINGS_CACHE_KEY);
    return;
  }
  localStorage.setItem(LISTINGS_CACHE_KEY, JSON.stringify({ ts: Date.now(), records }));
}

function normalizeListingRecord(record, index) {
  const safeFields =
    record?.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
      ? record.fields
      : {};

  const safeImages = Array.isArray(safeFields.Image) ? safeFields.Image : [];

  return {
    id: (record?.id || `listing-${index + 1}`).toString(),
    createdTime: record?.createdTime || null,
    fields: {
      ...safeFields,
      Title:
        typeof safeFields.Title === 'string' && safeFields.Title.trim()
          ? safeFields.Title.trim()
          : `Untitled Property #${index + 1}`,
      Location:
        typeof safeFields.Location === 'string' && safeFields.Location.trim()
          ? safeFields.Location.trim()
          : 'Location not specified',
      Price:
        safeFields.Price === null || safeFields.Price === undefined || safeFields.Price === ''
          ? null
          : safeFields.Price,
      Image: safeImages
    }
  };
}

function normalizeListingRecords(records) {
  if (!Array.isArray(records)) return [];
  const normalized = records
    .filter((record) => record && typeof record === 'object' && !Array.isArray(record))
    .map((record, index) => normalizeListingRecord(record, index));

  if (DEMO_MISSING_FIELDS && normalized.length > 0) {
    const first = normalized[0];
    normalized[0] = {
      ...first,
      fields: {
        ...(first.fields || {}),
        Title: '',
        Location: '',
        Price: null,
        Description: null,
        Image: []
      }
    };
  }

  return normalized;
}

async function fetchListingsFromStaticJson() {
  const endpoints = [
    LISTINGS_STATIC_ENDPOINT,
    'data/listings.json',
    './data/listings.json'
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJsonWithTimeout(endpoint, `listings (${endpoint})`);
      if (DEMO_EMPTY_DATASET && /listings\.json/i.test(endpoint)) {
        return [];
      }
      if (Array.isArray(data.records)) return data.records;
      if (Array.isArray(data)) return data;
      throw new Error(`Invalid response structure for listings at ${endpoint}.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to load static listings JSON.');
}

function triggerListingsFallback(message) {
  allListings = [];
  newLaunchRecordIds = new Set();
  showError(message || 'Content temporarily unavailable. Please try again.');
  updateResultsSummary(0, 1, 1);
}

async function fetchListings() {
  showLoading();
  try {
    const cachedRecords = getListingsCache();
    let records = cachedRecords;
    if (!records) {
      records = await fetchListingsFromStaticJson();
      setListingsCache(records);
    }

    allListings = normalizeListingRecords(records);
    clearListingsSlowLoadNotice();
    newLaunchRecordIds = computeNewLaunchRecordIds(allListings);
    if (allListings.length === 0) {
      showError('No properties available at the moment.');
    } else {
      hydrateFilterOptions(allListings);
      applyQueryParamsToFilters();
      applyAreaPageContext(allListings);
      if (isAreasPage) {
        fetchAreaQuestionsRecords()
          .then(() => applyAreaPageContext(allListings))
          .catch((error) => console.warn('Unable to hydrate area cards with descriptions', error));
      }
      applyFiltersAndRender();
    }
  } catch (error) {
    console.error('Listings data error:', classifyFetchFailure(error));
    triggerListingsFallback('Content temporarily unavailable. Please try again.');
  }
}

// Filtering and sorting logic

async function applyFiltersAndRender(input) {
  try {
    if (isAreasPage && !fixedAreaLocation) {
      const listingsContainer = getListingsContainer();
      if (listingsContainer) listingsContainer.innerHTML = '';
      const summary = document.getElementById('results-summary');
      if (summary) summary.innerHTML = '';
      return;
    }

    const requestedPage = typeof input === 'number' && Number.isFinite(input) ? Math.max(1, Math.floor(input)) : 1;
    let filtered = [...allListings];

    // Get filter values
    const selectedLocation = document.getElementById('filter-location')?.value || '';
    const location = fixedAreaLocation || selectedLocation;
    const type = document.getElementById('filter-type')?.value || '';
    const listingType = document.getElementById('filter-listing-type')?.value || '';
    const isNewLaunchFilter = listingType === '__new_launch__';
    const minPrice = parseInt(document.getElementById('filter-min-price')?.value, 10);
    const maxPrice = parseInt(document.getElementById('filter-max-price')?.value, 10);
    const sort = document.getElementById('sort-price')?.value || 'newest';
    const effectiveSort = sort === 'default' ? 'newest' : sort;
    const keywordQuery = getKeywordQuery();

    if (isNewLaunchesPage || isNewLaunchFilter) {
      filtered = filtered.filter(record => newLaunchRecordIds.has(record.id));
    }

    filtered = filtered.filter(record => {
    const f = record.fields;
    let pass = true;
    if (location && (f['Location'] || '').trim().toLowerCase() !== location.trim().toLowerCase()) pass = false;
    if (type && getPropertyTypeValue(f) !== type) pass = false;
    if (!isNewLaunchFilter && listingType && getOfferTypeValue(f) !== listingType) pass = false;
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

    if (effectiveSort === 'newest') {
      filtered.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
    } else if (effectiveSort === 'last-viewed' || effectiveSort === 'recent') {
      const lastViewedMap = getLastViewedMap();
      filtered.sort((a, b) => {
        const aLastViewed = Number(lastViewedMap[a.id]) || 0;
        const bLastViewed = Number(lastViewedMap[b.id]) || 0;
        if (bLastViewed !== aLastViewed) return bLastViewed - aLastViewed;
        return new Date(b.createdTime || 0) - new Date(a.createdTime || 0);
      });
    } else if (effectiveSort === 'price-asc') {
      filtered.sort((a, b) => (Number(a.fields?.['Price']) || 0) - (Number(b.fields?.['Price']) || 0));
    } else if (effectiveSort === 'price-desc') {
      filtered.sort((a, b) => (Number(b.fields?.['Price']) || 0) - (Number(a.fields?.['Price']) || 0));
    }

    await renderPaginatedListings(filtered, requestedPage);
    updateResultsSummary(filtered.length, currentListingsPage, Math.max(1, Math.ceil(filtered.length / LISTINGS_PER_PAGE)));
  } catch (error) {
    console.error('Rendering failure in listings UI:', error);
    triggerListingsFallback('Content temporarily unavailable. Please try again.');
  }
}

function updateResultsSummary(count, page = 1, totalPages = 1) {
  const summary = document.getElementById('results-summary');
  if (summary) {
    if (count === 0) {
      summary.innerHTML = 'No properties available at the moment.';
    } else {
      const pageText = totalPages > 1 ? ` (Page ${page} of ${totalPages})` : '';
      if (isNewLaunchesPage) {
        summary.innerHTML = `Showing <strong>${count}</strong> new listing${count === 1 ? '' : 's'}${pageText}`;
      } else {
        summary.innerHTML = `Showing <strong>${count}</strong> propert${count === 1 ? 'y' : 'ies'}${pageText}`;
      }
    }
  }
}

function clearListingsQueryParams() {
  const url = new URL(window.location.href);
  ['q', 'location', 'propertyType', 'type', 'offerType', 'listingType'].forEach((key) => {
    url.searchParams.delete(key);
  });

  if (!isAreasPage) {
    url.searchParams.delete('area');
  }

  window.history.replaceState({}, '', url.toString());
}

function resetListingsFilters() {
  const keywordInput = document.getElementById('filter-keyword');
  const locationFilter = document.getElementById('filter-location');
  const typeFilter = document.getElementById('filter-type');
  const listingTypeFilter = document.getElementById('filter-listing-type');
  const minInput = document.getElementById('filter-min-price');
  const maxInput = document.getElementById('filter-max-price');
  const priceSlider = document.getElementById('filter-price-range');
  const minLabel = document.getElementById('min-price-label');
  const maxLabel = document.getElementById('max-price-label');
  const sortFilter = document.getElementById('sort-price');

  if (keywordInput) keywordInput.value = '';
  if (locationFilter) {
    locationFilter.value = fixedAreaLocation || '';
    locationFilter.selectedIndex = fixedAreaLocation ? locationFilter.selectedIndex : 0;
  }
  if (typeFilter) {
    typeFilter.value = '';
    typeFilter.selectedIndex = 0;
  }
  if (listingTypeFilter) {
    listingTypeFilter.value = isNewLaunchesPage ? '__new_launch__' : '';
    if (!isNewLaunchesPage) listingTypeFilter.selectedIndex = 0;
  }
  if (minInput) minInput.value = '';
  if (maxInput) maxInput.value = '';
  if (priceSlider) priceSlider.value = '0';
  if (minLabel) minLabel.textContent = '₹0';
  if (maxLabel) maxLabel.textContent = '₹10 Cr+';
  if (sortFilter) sortFilter.value = 'newest';

  clearListingsQueryParams();
}

// Event listeners for filters and sort (with debug logging)
function initListingsPage() {
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
      resetListingsFilters();
      applyFiltersAndRender();
    });
    console.log('[airtable.js] Reset filters button event attached');
  } else {
    console.warn('[airtable.js] Reset filters button not found');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initListingsPage);
} else {
  initListingsPage();
}

function renderListings(records) {
  const listingsContainer = getListingsContainer();
  if (!listingsContainer) return;

  if (!records || records.length === 0) {
    listingsContainer.innerHTML =
      '<div class="no-listings">No properties available at the moment.</div>';
    return;
  }
  listingsContainer.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'property-grid';
  records.forEach(record => {
    try {
      const card = createPropertyCard(record);
      if (card) grid.appendChild(card);
    } catch (error) {
      console.error('Skipping malformed listing card payload:', error);
    }
  });

  if (!grid.childElementCount) {
    listingsContainer.innerHTML =
      '<div class="no-listings">No properties available at the moment.</div>';
    return;
  }

  listingsContainer.appendChild(grid);
}

async function hydrateRecordsForCardImages(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const hydrated = [...records];
  const pendingIndexes = [];

  for (let index = 0; index < hydrated.length; index += 1) {
    const record = hydrated[index];
    if (!record?.id) continue;

    const shouldRefresh = shouldRefreshRecordImages(record);
    const shouldWarmAirtable = hasAirtableHostedImages(record);
    if (!shouldRefresh && !shouldWarmAirtable) continue;

    const cachedImages = getCachedRefreshedImages(record.id);
    if (cachedImages.length > 0) {
      hydrated[index] = cloneRecordWithImages(record, cachedImages);
      continue;
    }

    pendingIndexes.push(index);
  }

  if (pendingIndexes.length > 0) {
    await Promise.all(
      pendingIndexes.map(async (index) => {
        const record = hydrated[index];
        try {
          hydrated[index] = await ensureRecordHasFreshImages(record);
        } catch (innerError) {
          console.warn('Failed to hydrate listing card images', innerError);
        }
      })
    );
  }

  let changed = false;
  hydrated.forEach((record, index) => {
    if (record !== records[index]) changed = true;
  });

  if (changed && Array.isArray(allListings) && allListings.length > 0) {
    const hydratedById = new Map(hydrated.map((record) => [record.id, record]));
    allListings = allListings.map((record) => hydratedById.get(record.id) || record);
    setListingsCache(allListings);
  }

  return hydrated;
}

async function renderPaginatedListings(records, requestedPage) {
  const total = Array.isArray(records) ? records.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / LISTINGS_PER_PAGE));
  currentListingsPage = Math.min(Math.max(1, requestedPage), totalPages);

  const startIndex = (currentListingsPage - 1) * LISTINGS_PER_PAGE;
  const endIndex = startIndex + LISTINGS_PER_PAGE;
  const pageRecords = records.slice(startIndex, endIndex);
  const hydratedPageRecords = await hydrateRecordsForCardImages(pageRecords);

  renderListings(hydratedPageRecords);
  renderPaginationControls(totalPages, currentListingsPage);
}

function renderPaginationControls(totalPages, currentPage) {
  const listingsContainer = getListingsContainer();
  if (!listingsContainer) return;
  if (totalPages <= 1) return;

  const wrapper = document.createElement('nav');
  wrapper.className = 'listings-pagination';
  wrapper.setAttribute('aria-label', 'Listings pagination');
  wrapper.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:0.5rem;margin-top:1.5rem;';

  const createButton = (label, page, disabled = false, active = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    button.style.cssText =
      'min-width:2.35rem;height:2.35rem;padding:0 0.7rem;border-radius:10px;border:1px solid #cbd5e1;background:#fff;color:#1e293b;font-weight:600;cursor:pointer;';

    if (active) {
      button.style.background = '#1e40af';
      button.style.borderColor = '#1e40af';
      button.style.color = '#fff';
      button.setAttribute('aria-current', 'page');
    }

    if (disabled) {
      button.style.opacity = '0.55';
      button.style.cursor = 'not-allowed';
    } else {
      button.addEventListener('click', () => applyFiltersAndRender(page));
    }

    return button;
  };

  wrapper.appendChild(createButton('Prev', currentPage - 1, currentPage <= 1, false));

  for (let page = 1; page <= totalPages; page += 1) {
    wrapper.appendChild(createButton(String(page), page, false, page === currentPage));
  }

  wrapper.appendChild(createButton('Next', currentPage + 1, currentPage >= totalPages, false));
  listingsContainer.appendChild(wrapper);
}

function getSiteBaseUrl() {
  return getSiteRootUrl();
}

function buildPropertyShareUrl(recordId) {
  return new URL(`property-share/${encodeURIComponent(recordId)}.html`, getSiteBaseUrl()).toString();
}

function buildPropertyShareText({ title, location, price, listingType, url }) {
  return [
    `Property: ${title}`,
    `Location: ${location}`,
    `Type: ${listingType}`,
    `Price: ${price}`,
    `Link: ${url}`
  ].join('\n');
}

function parseNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return NaN;
  const normalized = value.replace(/,/g, '');
  const match = normalized.match(/\d+(\.\d+)?/);
  if (!match) return NaN;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getComparableSize(fields) {
  const candidates = [fields['Size (sqft)'], fields['Area'], fields['Size']];
  for (const candidate of candidates) {
    const parsed = parseNumericValue(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return NaN;
}

function formatCompactPrice(fields) {
  return formatDisplayPrice(fields['Price']);
}

function isSizeSimilar(baseSize, candidateSize) {
  if (!Number.isFinite(baseSize) || !Number.isFinite(candidateSize)) return false;
  const larger = Math.max(baseSize, candidateSize);
  const smaller = Math.min(baseSize, candidateSize);
  return smaller / larger >= 0.75;
}

function getSuggestedProperties(records, currentRecord, limit = 3) {
  if (!Array.isArray(records) || !currentRecord) return [];

  const baseFields = currentRecord.fields || {};
  const baseLocation = (baseFields['Location'] || '').trim().toLowerCase();
  const baseType = (getPropertyTypeValue(baseFields) || '').trim().toLowerCase();
  const baseSize = getComparableSize(baseFields);

  return records
    .filter(item => item?.id && item.id !== currentRecord.id)
    .map(item => {
      const fields = item.fields || {};
      const location = (fields['Location'] || '').trim().toLowerCase();
      const type = (getPropertyTypeValue(fields) || '').trim().toLowerCase();
      const size = getComparableSize(fields);

      const areaMatch = Boolean(baseLocation && location && baseLocation === location);
      const typeMatch = Boolean(baseType && type && baseType === type);
      const sizeMatch = isSizeSimilar(baseSize, size);

      const score = (areaMatch ? 4 : 0) + (typeMatch ? 3 : 0) + (sizeMatch ? 2 : 0);
      return { item, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bTime = new Date(b.item.createdTime || 0).getTime();
      const aTime = new Date(a.item.createdTime || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, limit)
    .map(entry => entry.item);
}

function renderSuggestedMiniCards(records, mode = 'page') {
  if (!records.length) return '';

  return records.map(record => {
    const fields = record.fields || {};
    const title = toSafeDisplayText(fields['Title'], 'Untitled');
    const location = toSafeDisplayText(fields['Location'], 'Location not specified');
    const type = toSafeDisplayText(getPropertyTypeValue(fields), 'Property');
    const sizeRaw = toSafeDisplayText(fields['Area'] || fields['Size (sqft)'], '');
    const sizeText = sizeRaw ? ` | ${sizeRaw}` : '';
    const price = formatCompactPrice(fields);
    const imageUrl =
      resolveImageUrl(fields['Image']?.[0]?.thumbnails?.small?.url) ||
      resolveImageUrl(fields['Image']?.[0]?.url) ||
      CARD_IMAGE_FALLBACK;
    const safeTitle = escapeHtml(title);
    const safeLocation = escapeHtml(location);
    const safeType = escapeHtml(type);
    const safePrice = escapeHtml(price);
    const safeImageUrl = escapeHtml(imageUrl);

    if (mode === 'modal') {
      return `
        <button type="button" class="suggested-mini-card suggested-mini-card-modal" data-record-id="${record.id}" aria-label="Open ${safeTitle}">
          <img src="${safeImageUrl}" alt="${safeTitle}" class="suggested-mini-thumb" loading="lazy" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';" />
          <div class="suggested-mini-body">
            <p class="suggested-mini-name">${safeTitle}</p>
            <p class="suggested-mini-meta">${safeLocation} | ${safeType}${sizeText}</p>
            <p class="suggested-mini-price">${safePrice}</p>
          </div>
        </button>
      `;
    }

    const detailUrl = buildPropertyShareUrl(record.id);
    return `
      <a href="${detailUrl}" class="suggested-mini-card" aria-label="View ${safeTitle}">
        <img src="${safeImageUrl}" alt="${safeTitle}" class="suggested-mini-thumb" loading="lazy" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';" />
        <div class="suggested-mini-body">
          <p class="suggested-mini-name">${safeTitle}</p>
          <p class="suggested-mini-meta">${safeLocation} | ${safeType}${sizeText}</p>
          <p class="suggested-mini-price">${safePrice}</p>
        </div>
      </a>
    `;
  }).join('');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function ensureShareSheetStyles() {
  if (document.getElementById('property-share-sheet-style')) return;

  const style = document.createElement('style');
  style.id = 'property-share-sheet-style';
  style.textContent = `
    .property-share-sheet-overlay {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.58);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 12000;
      padding: 1rem;
    }
    .property-share-sheet {
      width: min(760px, 96vw);
      max-height: min(88vh, 820px);
      overflow: auto;
      background: #f8fafc;
      color: #0f172a;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.36);
      box-shadow: 0 22px 56px rgba(2, 6, 23, 0.3);
    }
    .property-share-sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.1rem 0.75rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.25);
    }
    .property-share-sheet-title {
      font-size: 2rem;
      font-weight: 700;
      margin: 0;
    }
    .property-share-sheet-close {
      border: none;
      background: transparent;
      font-size: 2rem;
      line-height: 1;
      color: #0f172a;
      cursor: pointer;
      padding: 0.15rem 0.35rem;
      border-radius: 8px;
    }
    .property-share-sheet-body {
      padding: 1rem 1.1rem 0.9rem;
    }
    .property-share-sheet-subtitle {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0 0 0.75rem 0;
    }
    .property-share-sheet-property {
      display: grid;
      grid-template-columns: 88px 1fr;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.95rem;
    }
    .property-share-sheet-thumb {
      width: 88px;
      height: 66px;
      border-radius: 10px;
      object-fit: cover;
      background: #e2e8f0;
    }
    .property-share-sheet-name {
      margin: 0 0 0.2rem;
      font-size: 1.05rem;
      font-weight: 700;
      color: #0f172a;
    }
    .property-share-sheet-meta {
      margin: 0;
      font-size: 0.94rem;
      color: #475569;
      line-height: 1.45;
    }
    .property-share-sheet-label {
      margin: 0.6rem 0 0.4rem;
      font-size: 0.92rem;
      font-weight: 600;
      color: #334155;
    }
    .property-share-sheet-linkrow {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.35);
      padding-bottom: 0.85rem;
    }
    .property-share-sheet-link {
      flex: 1;
      border: none;
      background: transparent;
      color: #0f172a;
      font-size: 0.95rem;
      outline: none;
      padding: 0.2rem 0;
    }
    .property-share-sheet-copy {
      border: none;
      background: transparent;
      color: #0e7490;
      font-size: 0.92rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .property-share-sheet-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
      margin-top: 1rem;
      padding-bottom: 0.35rem;
    }
    .property-share-sheet-action {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      color: #0f172a;
      gap: 0.35rem;
      font-size: 0.92rem;
      font-weight: 600;
    }
    .property-share-sheet-action-icon {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .property-share-sheet-action.whatsapp .property-share-sheet-action-icon {
      background: #25d366;
      color: #fff;
    }
    .property-share-sheet-action.native .property-share-sheet-action-icon {
      background: #0f172a;
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}

function openPropertyShareSheet(record, shareLink) {
  ensureShareSheetStyles();

  const existing = document.getElementById('property-share-sheet-overlay');
  if (existing) existing.remove();

  const fields = record?.fields || {};
  const title = toSafeDisplayText(fields['Title'], 'Property');
  const location = toSafeDisplayText(fields['Location'], 'Location not specified');
  const price = formatDisplayPrice(fields['Price']);
  const listingType = toSafeDisplayText(getOfferTypeValue(fields), 'Property');
  const thumbUrl = fields['Image']?.[0]?.thumbnails?.small?.url || fields['Image']?.[0]?.url || 'https://via.placeholder.com/176x132?text=Property';
  const shareText = buildPropertyShareText({ title, location, price, listingType, url: shareLink });
  const whatsappShareLink = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const safeTitle = escapeHtml(title);
  const safeLocation = escapeHtml(location);
  const safeListingType = escapeHtml(listingType);
  const safePrice = escapeHtml(price);
  const safeThumbUrl = escapeHtml(resolveImageUrl(thumbUrl) || CARD_IMAGE_FALLBACK);
  const safeShareLink = escapeHtml(shareLink || '');

  const overlay = document.createElement('div');
  overlay.id = 'property-share-sheet-overlay';
  overlay.className = 'property-share-sheet-overlay';
  overlay.innerHTML = `
    <div class="property-share-sheet" role="dialog" aria-modal="true" aria-label="Share property">
      <div class="property-share-sheet-header">
        <h3 class="property-share-sheet-title">Share</h3>
        <button type="button" class="property-share-sheet-close" aria-label="Close share panel">&times;</button>
      </div>
      <div class="property-share-sheet-body">
        <p class="property-share-sheet-subtitle">Send a link</p>
        <div class="property-share-sheet-property">
          <img src="${safeThumbUrl}" alt="${safeTitle}" class="property-share-sheet-thumb" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';" />
          <div>
            <p class="property-share-sheet-name">${safeTitle}</p>
            <p class="property-share-sheet-meta">${safeLocation} • ${safeListingType} • ${safePrice}</p>
          </div>
        </div>
        <p class="property-share-sheet-label">Link to share</p>
        <div class="property-share-sheet-linkrow">
          <input class="property-share-sheet-link" type="text" readonly value="${safeShareLink}" />
          <button type="button" class="property-share-sheet-copy">COPY LINK</button>
        </div>
        <div class="property-share-sheet-actions">
          <a href="${whatsappShareLink}" class="property-share-sheet-action whatsapp" target="_blank" rel="noopener" data-lead-type="${encodeURIComponent(title)}">
            <span class="property-share-sheet-action-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.8 0-65.7-10.8-94.2-30.6l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5c-.1 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>
            </span>
            <span>WhatsApp</span>
          </a>
          <button type="button" class="property-share-sheet-action native">
            <span class="property-share-sheet-action-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M18 16c-1.3 0-2.4.8-2.8 1.9L8.9 14.7c.1-.2.1-.5.1-.7s0-.5-.1-.7l6.2-3.2C15.6 11.2 16.7 12 18 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4c0 .2 0 .5.1.7L7.9 11.9C7.4 10.8 6.3 10 5 10c-2.2 0-4 1.8-4 4s1.8 4 4 4c1.3 0 2.4-.8 2.9-1.9l6.2 3.2c-.1.2-.1.5-.1.7 0 2.2 1.8 4 4 4s4-1.8 4-4-1.8-4-4-4z"/></svg>
            </span>
            <span>More Apps</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeButton = overlay.querySelector('.property-share-sheet-close');
  const copyButton = overlay.querySelector('.property-share-sheet-copy');
  const nativeButton = overlay.querySelector('.property-share-sheet-action.native');
  const linkInput = overlay.querySelector('.property-share-sheet-link');

  const closeSheet = () => overlay.remove();

  closeButton.addEventListener('click', closeSheet);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeSheet();
  });

  copyButton.addEventListener('click', async () => {
    try {
      await copyTextToClipboard(shareLink);
      copyButton.textContent = 'COPIED';
      window.setTimeout(() => {
        copyButton.textContent = 'COPY LINK';
      }, 1400);
    } catch (error) {
      copyButton.textContent = 'FAILED';
      window.setTimeout(() => {
        copyButton.textContent = 'COPY LINK';
      }, 1400);
    }
  });

  linkInput.addEventListener('focus', () => linkInput.select());

  nativeButton.addEventListener('click', async () => {
    if (!navigator.share || !window.isSecureContext) {
      nativeButton.querySelector('span:last-child').textContent = 'Not available';
      window.setTimeout(() => {
        nativeButton.querySelector('span:last-child').textContent = 'More Apps';
      }, 1400);
      return;
    }
    try {
      await navigator.share({
        title,
        text: shareText,
        url: shareLink
      });
    } catch (error) {
      // Ignore user cancellation
    }
  });
}

function setCopyButtonMessage(button, message) {
  const labelTarget = button.querySelector('.modal-share-option-text') || button;
  const originalLabel = button.dataset.originalLabel || labelTarget.textContent;
  button.dataset.originalLabel = originalLabel;
  labelTarget.textContent = message;
  window.setTimeout(() => {
    labelTarget.textContent = originalLabel;
  }, 1500);
}

function createPropertyCard(record) {
  const fields = record.fields;
  const firstImage = Array.isArray(fields['Image']) ? fields['Image'][0] : null;
  const imageSources = getAttachmentImageSources(firstImage);
  const imageUrl = imageSources.card || CARD_IMAGE_FALLBACK;
  const imageFullUrl = imageSources.full || imageUrl;
  const imageSrcSet =
    imageFullUrl && imageFullUrl !== imageUrl ? `${imageUrl} 1x, ${imageFullUrl} 2x` : '';
  const title = toSafeDisplayText(fields['Title'], 'Untitled');
  const location = toSafeDisplayText(fields['Location'], 'Location not specified');
  const price = formatDisplayPrice(fields['Price']);
  const listingType = toSafeDisplayText(getOfferTypeValue(fields), 'Property');
  const showNewBadge = isRecentlyAdded(record.createdTime, NEW_LISTING_WINDOW_DAYS);
  const shortDescription = toSafeDisplayText(fields['Short Description'] || fields['Description'], '');
  const description = shortDescription ? truncateText(shortDescription, 110) : '';
  const escapedImageUrl = escapeHtml(imageUrl);
  const escapedImageSrcSet = escapeHtml(imageSrcSet);
  const escapedTitle = escapeHtml(title);
  const escapedLocation = escapeHtml(location);
  const escapedDescription = escapeHtml(description);
  const escapedPrice = escapeHtml(price);
  const escapedListingType = escapeHtml(listingType);

  const wrapper = document.createElement('div');
  wrapper.className = 'bento-card-wrapper';
  const card = document.createElement('div');
  card.className = 'bento-card';
  card.style.cursor = 'pointer';
  card.innerHTML = `
    <div class="listing-image-container">
      <img class="property-image" src="${escapedImageUrl}" ${imageSrcSet ? `srcset="${escapedImageSrcSet}" sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"` : ''} alt="${escapedTitle}" loading="lazy" decoding="async" fetchpriority="low" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';" />
      <div class="bento-badge">${escapedListingType}</div>
      ${showNewBadge ? '<div class="bento-badge bento-badge-new">New</div>' : ''}
    </div>
    <div class="bento-content" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
      <h3 class="property-title">${escapedTitle}</h3>
      <div class="property-location">${escapedLocation}</div>
      ${escapedDescription ? `<div class="property-description">${escapedDescription}</div>` : ''}
      <div class="property-price">${escapedPrice}</div>
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
  markListingAsViewed(recordId);
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
    hydrateModalImageGallery();
    hydrateModalShareActions(record);
    hydrateModalSuggestedActions();
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

// Fetch property detail from cached/static listings data
async function fetchPropertyDetail(recordId) {
  const recordIndex = allListings.findIndex((record) => record.id === recordId);
  if (recordIndex >= 0) {
    const localRecord = allListings[recordIndex];
    const hydratedRecord = await ensureRecordHasFreshImages(localRecord);
    if (hydratedRecord !== localRecord) {
      allListings[recordIndex] = hydratedRecord;
      setListingsCache(allListings);
    }
    return hydratedRecord;
  }
  throw new Error('Property not found in static listings data.');
}

function hydrateModalShareActions(record) {
  const modalBody = document.getElementById('modal-body');
  if (!modalBody || !record) return;

  const shareRoot = modalBody.querySelector('.modal-share-fab');
  if (!shareRoot) return;

  const mainButton = shareRoot.querySelector('.modal-share-main');
  const shareLink = shareRoot.dataset.shareUrl || buildPropertyShareUrl(record.id);

  if (!mainButton) return;

  mainButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    mainButton.setAttribute('aria-expanded', 'false');
    shareRoot.classList.remove('is-open');
    openPropertyShareSheet(record, shareLink);
  });
}

function hydrateModalSuggestedActions() {
  const modalBody = document.getElementById('modal-body');
  if (!modalBody) return;

  const suggestedButtons = modalBody.querySelectorAll('.suggested-mini-card-modal[data-record-id]');
  suggestedButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.recordId;
      if (!targetId) return;
      openPropertyModal(targetId);
    });
  });
}

function hydrateModalImageGallery() {
  const modalBody = document.getElementById('modal-body');
  if (!modalBody) return;

  const mainImage = modalBody.querySelector('#modal-primary-image');
  if (!mainImage) return;

  const thumbs = modalBody.querySelectorAll('.modal-gallery-thumb[data-image]');
  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const nextSrc = thumb.dataset.image;
      if (!nextSrc) return;
      mainImage.src = nextSrc;
      thumbs.forEach((item) => item.classList.remove('is-active'));
      thumb.classList.add('is-active');
    });
  });
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
  const galleryImages = Array.isArray(fields['Image'])
    ? fields['Image'].map((image) => resolveImageUrl(image?.url)).filter(Boolean)
    : [];
  const imageUrl = galleryImages[0] || CARD_IMAGE_FALLBACK;
  const title = toSafeDisplayText(fields['Title'], 'Untitled');
  const location = toSafeDisplayText(fields['Location'], 'Location not specified');
  const price = formatDisplayPrice(fields['Price']);
  const description = toSafeDisplayText(fields['Description'], '');
  const type = toSafeDisplayText(fields['Property Type'] || fields['Type'], '');
  const listingType = toSafeDisplayText(fields['Offer Type'] || fields['ListingType'], '');
  const area = toSafeDisplayText(fields['Area'] || fields['Size (sqft)'] ? `${fields['Area'] || fields['Size (sqft)']}${fields['Size (sqft)'] && !fields['Area'] ? ' sqft' : ''}` : '', '');
  const bedrooms = toSafeDisplayText(fields['Bedrooms'], '');
  const bathrooms = toSafeDisplayText(fields['Bathrooms'], '');
  const amenities = toSafeDisplayText(Array.isArray(fields['Amenities']) ? fields['Amenities'].join(', ') : fields['Amenities'], '');
  const status = toSafeDisplayText(fields['Status'], '');
  const floor = toSafeDisplayText(fields['Floor'], '');
  const age = toSafeDisplayText(fields['Age'], '');
  const facing = toSafeDisplayText(fields['Facing'], '');
  const parking = toSafeDisplayText(fields['Parking'], '');
  const furnishing = toSafeDisplayText(fields['Furnishing'], '');
  const whatsappNumber = '919860826918';
  const enquiryWhatsappMsg = encodeURIComponent(`Hi, I'm interested in the property: ${title} (${location}) for ${price}`);
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${enquiryWhatsappMsg}`;
  const propertyUrl = buildPropertyShareUrl(record.id);
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
      <div class="property-detail-stat-label">${escapeHtml(detail.label)}</div>
      <div class="property-detail-stat-value">${escapeHtml(detail.value)}</div>
    </div>
  `).join('');
  const galleryThumbsMarkup = galleryImages.map((url, index) => `
    <button type="button" class="modal-gallery-thumb${index === 0 ? ' is-active' : ''}" data-image="${url}" aria-label="View image ${index + 1}">
      <img src="${url}" alt="${escapeHtml(title)} image ${index + 1}" loading="lazy" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';" />
    </button>
  `).join('');
  const suggestedRecords = getSuggestedProperties(allListings, record, 3);
  const suggestedMarkup = renderSuggestedMiniCards(suggestedRecords, 'modal');

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
      .modal-share-fab {
        position: absolute;
        left: 5.6rem;
        bottom: 1.35rem;
        z-index: 4;
      }
      .modal-share-main {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 58px;
        height: 58px;
        border-radius: 999px;
        border: none;
        padding: 0 !important;
        background: #e11d48;
        color: #fff;
        cursor: pointer;
        box-shadow: 0 12px 24px rgba(225, 29, 72, 0.28);
        transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      }
      .modal-share-main:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 28px rgba(225, 29, 72, 0.34);
        background: #be123c;
      }
      .modal-gallery-thumbs {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
        gap: 0.5rem;
        padding: 0.8rem 1.35rem 0;
      }
      .modal-gallery-thumb {
        border: 1px solid ${theme.panelBorder};
        border-radius: 10px;
        overflow: hidden;
        cursor: pointer;
        padding: 0;
        background: ${theme.panelBg};
        opacity: 0.82;
        transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }
      .modal-gallery-thumb:hover,
      .modal-gallery-thumb.is-active {
        opacity: 1;
        border-color: ${theme.accent};
        transform: translateY(-1px);
      }
      .modal-gallery-thumb img {
        width: 100%;
        height: 64px;
        display: block;
        object-fit: cover;
      }
      @media (max-width: 600px) {
        .modal-whatsapp-icon {
          width: 54px;
          height: 54px;
        }
        .modal-whatsapp-float { left: 1rem; bottom: 1rem; }
        .modal-share-fab { left: 4.9rem; bottom: 1rem; }
        .modal-share-main { width: 54px; height: 54px; }
      }
    </style>
    <div class="property-modal-content" style="background:${theme.modalBg}; border-radius:22px; max-width:960px; min-width:340px; width:100%; box-shadow:${theme.shadow}; overflow-y:auto; overflow-x:hidden; max-height:90vh; border:1px solid ${theme.panelBorder};">
      <img id="modal-primary-image" src="${imageUrl}" alt="${escapeHtml(title)}" class="property-detail-image" style="width:100%; max-height:320px; object-fit:cover; display:block; background:${panelBackground};" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';" />
      ${galleryImages.length > 1 ? `<div class="modal-gallery-thumbs">${galleryThumbsMarkup}</div>` : ''}
      <div class="property-detail-body" style="display:grid; grid-template-columns: 1.1fr 0.9fr; gap:1.25rem; padding:1.35rem;">
        <div class="property-detail-main" style="position:relative; background:${theme.panelBg}; border:1px solid ${theme.panelBorder}; border-radius:18px; padding:1.35rem; padding-bottom:5.2rem;">
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; margin-bottom:0.75rem;">
            <span style="display:inline-flex; align-items:center; justify-content:center; min-height:32px; padding:0.35rem 0.8rem; border-radius:999px; background:${theme.badgeBg}; color:#fff; font-size:0.85rem; font-weight:700;">${escapeHtml(listingType || 'Property')}</span>
            ${type ? `<span style="display:inline-flex; align-items:center; justify-content:center; min-height:32px; padding:0.35rem 0.8rem; border-radius:999px; background:${theme.typeBadgeBg}; color:${theme.typeBadgeText}; font-size:0.85rem; font-weight:600;">${escapeHtml(type)}</span>` : ''}
          </div>
          <div class="property-detail-title" style="font-size:2rem; font-weight:700; color:${theme.title}; line-height:1.18; margin-bottom:0.6rem;">${escapeHtml(title)}</div>
          <div class="property-detail-location" style="font-size:1.02rem; color:${theme.text}; font-weight:500; margin-bottom:0.6rem;">${escapeHtml(location)}</div>
          <div class="property-detail-price" style="font-size:1.55rem; color:${theme.price}; font-weight:700; margin-bottom:0.75rem;">${escapeHtml(price)}</div>
          ${status ? `<div style="display:inline-flex; align-items:center; gap:0.55rem; margin-bottom:1rem; padding:0.45rem 0.8rem; border-radius:12px; background:${theme.pillBg}; border:1px solid ${theme.panelBorder};"><span style="font-size:0.76rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${theme.accent};">Status</span><span style="font-size:0.96rem; font-weight:600; color:${theme.pillText};">${escapeHtml(status)}</span></div>` : ''}
          ${description ? `<div class="property-detail-description" style="font-size:1rem; color:${theme.mutedText}; line-height:1.8;">${escapeHtml(description)}</div>` : ''}
          <div class="modal-share-fab" data-share-url="${propertyUrl}">
            <button type="button" class="modal-share-main" aria-label="Share property" aria-expanded="false">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M18 16c-1.3 0-2.4.8-2.8 1.9L8.9 14.7c.1-.2.1-.5.1-.7s0-.5-.1-.7l6.2-3.2C15.6 11.2 16.7 12 18 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4c0 .2 0 .5.1.7L7.9 11.9C7.4 10.8 6.3 10 5 10c-2.2 0-4 1.8-4 4s1.8 4 4 4c1.3 0 2.4-.8 2.9-1.9l6.2 3.2c-.1.2-.1.5-.1.7 0 2.2 1.8 4 4 4s4-1.8 4-4-1.8-4-4-4z"/></svg>
            </button>
          </div>
          <a href="${whatsappLink}" class="whatsapp-cta modal-whatsapp-float" target="_blank" rel="noopener" aria-label="Click to enquire on WhatsApp" data-lead-type="${encodeURIComponent(title)}">
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
              <div style="font-size:0.98rem; line-height:1.8; color:${theme.amenitiesText};">${escapeHtml(amenities)}</div>
            </div>
          ` : ''}
        </div>
      </div>
      ${suggestedRecords.length ? `
        <div style="padding:0 1.35rem 1.35rem;">
          <section class="suggested-mini-section" aria-label="Suggested properties">
            <h3 class="suggested-mini-title">Suggested Properties</h3>
            <div class="suggested-mini-grid">
              ${suggestedMarkup}
            </div>
          </section>
        </div>
      ` : ''}
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
          hydrateModalImageGallery();
          hydrateModalShareActions(currentModalRecord);
          hydrateModalSuggestedActions();
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

// ---
// Requirements:
// 1. Ensure /data/listings.json exists and follows { updatedAt, records }.
// 2. Ensure <div id="property-listings"></div> exists in your HTML.
// 3. Add <script src="js/airtable.js"></script> before </body>.
// ---
