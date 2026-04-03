(() => {
const PROPERTY_DETAIL_LISTINGS_ENDPOINT = '/data/listings.json';
const DETAIL_CACHE_KEY = 'property_detail_records_v4';
const DETAIL_CACHE_TTL = 10 * 60 * 1000;
const DETAIL_IMAGE_REFRESH_CACHE_KEY = 'property_detail_image_refresh_v1';
const DETAIL_IMAGE_REFRESH_TTL = 6 * 60 * 60 * 1000;
const DETAIL_JSON_FETCH_TIMEOUT_MS = 15000;
const IMAGE_FALLBACK_DATA_URI =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20800%20500%22%3E%3Crect%20width%3D%22800%22%20height%3D%22500%22%20fill%3D%22%23cbd5e1%22/%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%23334155%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2232%22%3EImage%20Unavailable%3C/text%3E%3C/svg%3E';

document.addEventListener(
  'error',
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (target.dataset.fallbackApplied === '1') return;
    target.dataset.fallbackApplied = '1';
    target.src = IMAGE_FALLBACK_DATA_URI;
  },
  true
);

function normalizePayloadRecords(payload) {
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

function getRecordIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function getListingsPath() {
  return '/listings/';
}

function getHomePath() {
  return '/';
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

function renderDeadEndState(container, message, redirectPath) {
  if (!container) return;
  const safeMessage = escapeHtml(message || 'This page is unavailable.');
  const safeRedirectPath = escapeHtml(redirectPath || getListingsPath());
  container.innerHTML = `
    <section class="error" style="display:grid;gap:0.9rem;padding:1.25rem;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc;max-width:720px;">
      <h2 style="margin:0;font-size:1.15rem;color:#0f172a;">Page unavailable</h2>
      <p style="margin:0;color:#334155;line-height:1.5;">${safeMessage}</p>
      <p style="margin:0;color:#475569;line-height:1.5;">Redirecting to listings in 4 seconds.</p>
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
        <a href="${safeRedirectPath}" style="display:inline-block;padding:0.55rem 0.9rem;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;">Go to Listings</a>
        <a href="${getHomePath()}" style="display:inline-block;padding:0.55rem 0.9rem;border-radius:8px;border:1px solid #cbd5e1;color:#0f172a;text-decoration:none;font-weight:600;">Go to Home</a>
      </div>
    </section>
  `;

  window.setTimeout(() => {
    window.location.replace(redirectPath || getListingsPath());
  }, 4000);
}

function getOfferTypeValue(fields) {
  return fields['Offer Type'] || fields['ListingType'] || '';
}

function getPropertyTypeValue(fields) {
  return fields['Property Type'] || fields['Type'] || '';
}

function getImageRefreshCache() {
  const cachedRaw = localStorage.getItem(DETAIL_IMAGE_REFRESH_CACHE_KEY);
  if (!cachedRaw) return {};
  try {
    const parsed = JSON.parse(cachedRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    console.warn('Invalid property image refresh cache payload', error);
  }
  return {};
}

function setImageRefreshCache(cache) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
    localStorage.removeItem(DETAIL_IMAGE_REFRESH_CACHE_KEY);
    return;
  }
  localStorage.setItem(DETAIL_IMAGE_REFRESH_CACHE_KEY, JSON.stringify(cache));
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

async function fetchDetailJsonWithTimeout(endpoint, label) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), DETAIL_JSON_FETCH_TIMEOUT_MS);
  try {
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

function shouldRefreshRecordImages(record) {
  const images = record?.fields?.Image;
  if (!Array.isArray(images) || images.length === 0) return false;
  return images.some((image) => {
    const candidateUrl =
      image?.thumbnails?.large?.url || image?.thumbnails?.full?.url || image?.url || '';
    return isLikelyExpiredAirtableImageUrl(candidateUrl);
  });
}

function getCachedRefreshedImages(recordId) {
  if (!recordId) return [];
  const cache = getImageRefreshCache();
  const entry = cache[recordId];
  if (!entry || !Array.isArray(entry.images)) return [];
  if (Date.now() - Number(entry.ts || 0) > DETAIL_IMAGE_REFRESH_TTL) return [];
  return normalizeImageAttachments(entry.images);
}

function cacheRefreshedImages(recordId, images) {
  if (!recordId) return;
  const normalized = normalizeImageAttachments(images);
  if (normalized.length === 0) return;
  const cache = getImageRefreshCache();
  cache[recordId] = { ts: Date.now(), images: normalized };
  setImageRefreshCache(cache);
}

async function fetchFreshRecordFromStatic(recordId) {
  if (!recordId) return null;
  let payload;
  try {
    payload = await fetchDetailJsonWithTimeout(
      `${PROPERTY_DETAIL_LISTINGS_ENDPOINT}?ts=${Date.now()}`,
      'property refresh listings'
    );
  } catch (error) {
    return null;
  }
  const records = normalizePayloadRecords(payload);
  return records.find((item) => item.id === recordId) || null;
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
    console.warn('Unable to refresh property images from static listings', error);
  }

  return record;
}

async function fetchStaticRecords() {
  const cachedRaw = localStorage.getItem(DETAIL_CACHE_KEY);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (
        Date.now() - cached.ts < DETAIL_CACHE_TTL &&
        Array.isArray(cached.records) &&
        cached.records.length > 0
      ) {
        return cached.records || [];
      }
    } catch (error) {
      console.warn('Invalid property detail cache', error);
    }
  }

  const payload = await fetchDetailJsonWithTimeout(
    PROPERTY_DETAIL_LISTINGS_ENDPOINT,
    'property detail listings'
  );
  const records = normalizePayloadRecords(payload);
  if (records.length > 0) {
    localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify({ ts: Date.now(), records }));
  } else {
    localStorage.removeItem(DETAIL_CACHE_KEY);
  }
  return records;
}

async function fetchPropertyDetail(recordId) {
  const records = await fetchStaticRecords();
  const recordIndex = records.findIndex((item) => item.id === recordId);
  if (recordIndex < 0) throw new Error('Property not found.');

  const record = records[recordIndex];
  const hydratedRecord = await ensureRecordHasFreshImages(record);
  if (hydratedRecord !== record) {
    records[recordIndex] = hydratedRecord;
    localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify({ ts: Date.now(), records }));
  }

  return { record: hydratedRecord, records };
}

function getSiteBaseUrl() {
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
    return new URL(normalized, getSiteBaseUrl()).toString();
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
    card: large || small || full,
    full: full || large || small
  };
}

function buildPropertyShareUrl(recordId) {
  return new URL(`property-share/${encodeURIComponent(recordId)}.html`, getSiteBaseUrl()).toString();
}

function buildPropertyShareText({ title, location, price, listingType, url }) {
  return [`Property: ${title}`, `Location: ${location}`, `Type: ${listingType}`, `Price: ${price}`, `Link: ${url}`].join('\n');
}

function upsertMetaAttribute(attr, name, content) {
  if (!content) return;
  const selector = `meta[${attr}="${name}"]`;
  let node = document.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attr, name);
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
}

function updatePropertyPageMetadata(record) {
  const fields = record?.fields || {};
  const title = fields.Title || 'Property Details';
  const location = fields.Location || 'East Pune';
  const listingType = getOfferTypeValue(fields) || 'Property';
  const descriptionSource = fields['Short Description'] || fields.Description || '';
  const description = descriptionSource
    ? descriptionSource.toString().trim().slice(0, 155)
    : `${listingType} property in ${location} listed with Shelters Realty.`;
  const shareUrl = buildPropertyShareUrl(record.id);
  const imageUrl =
    resolveImageUrl(fields['Image']?.[0]?.url) ||
    'https://via.placeholder.com/1200x630.png?text=Shelters+Realty+Property';

  document.title = `${title} | Shelters Realty`;
  upsertMetaAttribute('name', 'description', description);
  upsertMetaAttribute('property', 'og:title', `${title} | Shelters Realty`);
  upsertMetaAttribute('property', 'og:description', description);
  upsertMetaAttribute('property', 'og:type', 'article');
  upsertMetaAttribute('property', 'og:url', shareUrl);
  upsertMetaAttribute('property', 'og:image', imageUrl);

  const canonical = document.getElementById('canonical-url');
  if (canonical) {
    canonical.setAttribute('href', shareUrl);
  } else {
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.id = 'canonical-url';
    link.href = shareUrl;
    document.head.appendChild(link);
  }
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
    .filter((item) => item?.id && item.id !== currentRecord.id)
    .map((item) => {
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
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bTime = new Date(b.item.createdTime || 0).getTime();
      const aTime = new Date(a.item.createdTime || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

function extractGalleryImages(fields) {
  if (!Array.isArray(fields?.Image)) return [];
  return fields.Image
    .map((image) => {
      const sources = getAttachmentImageSources(image);
      return sources.full || sources.card || '';
    })
    .filter(Boolean);
}

function renderSuggestedMiniCards(records) {
  if (!records.length) return '';

  return records.map((record) => {
    const fields = record.fields || {};
    const title = toSafeDisplayText(fields['Title'], 'Untitled');
    const location = toSafeDisplayText(fields['Location'], 'Location not specified');
    const type = toSafeDisplayText(getPropertyTypeValue(fields), 'Property');
    const sizeRaw = toSafeDisplayText(fields['Area'] || fields['Size (sqft)'], '');
    const sizeText = sizeRaw ? ` | ${sizeRaw}` : '';
    const price = formatDisplayPrice(fields['Price']);
    const imageSources = getAttachmentImageSources(fields['Image']?.[0]);
    const imageUrl = imageSources.card || imageSources.full || IMAGE_FALLBACK_DATA_URI;
    const detailUrl = buildPropertyShareUrl(record.id);
    const safeTitle = escapeHtml(title);
    const safeLocation = escapeHtml(location);
    const safeType = escapeHtml(type);
    const safePrice = escapeHtml(price);
    const safeImageUrl = escapeHtml(imageUrl);

    return `
      <a href="${detailUrl}" class="suggested-mini-card" aria-label="View ${safeTitle}">
        <img src="${safeImageUrl}" alt="${safeTitle}" class="suggested-mini-thumb" loading="lazy" onerror="this.onerror=null;this.src='${IMAGE_FALLBACK_DATA_URI}';" />
        <div class="suggested-mini-body">
          <p class="suggested-mini-name">${safeTitle}</p>
          <p class="suggested-mini-meta">${safeLocation} | ${safeType}${sizeText}</p>
          <p class="suggested-mini-price">${safePrice}</p>
        </div>
      </a>
    `;
  }).join('');
}

async function hydrateRecordsWithFreshImages(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  return Promise.all(
    records.map(async (record) => {
      try {
        return await ensureRecordHasFreshImages(record);
      } catch (error) {
        return record;
      }
    })
  );
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
  const thumbUrl =
    resolveImageUrl(fields['Image']?.[0]?.thumbnails?.small?.url) ||
    resolveImageUrl(fields['Image']?.[0]?.url) ||
    'https://via.placeholder.com/176x132?text=Property';
  const shareText = buildPropertyShareText({ title, location, price, listingType, url: shareLink });
  const whatsappShareLink = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const safeTitle = escapeHtml(title);
  const safeLocation = escapeHtml(location);
  const safeListingType = escapeHtml(listingType);
  const safePrice = escapeHtml(price);
  const safeThumbUrl = escapeHtml(thumbUrl);
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
          <img src="${safeThumbUrl}" alt="${safeTitle}" class="property-share-sheet-thumb" onerror="this.onerror=null;this.src='${IMAGE_FALLBACK_DATA_URI}';" />
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

function bindShareButton(record) {
  const shareButton = document.getElementById('share-property-btn');
  if (!shareButton) return;
  const shareLink = buildPropertyShareUrl(record.id);
  shareButton.addEventListener('click', () => {
    openPropertyShareSheet(record, shareLink);
  });
}

function bindDetailImageGallery() {
  const mainImage = document.getElementById('detail-primary-image');
  if (!mainImage) return;

  const thumbs = document.querySelectorAll('.detail-gallery-thumb[data-image]');
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

function renderPropertyDetail(record, suggestedRecords = []) {
  const fields = record.fields || {};
  const galleryImages = extractGalleryImages(fields);
  const imageUrl = galleryImages[0] || IMAGE_FALLBACK_DATA_URI;
  const title = toSafeDisplayText(fields.Title, 'Untitled');
  const location = toSafeDisplayText(fields.Location, 'Location not specified');
  const price = formatDisplayPrice(fields.Price);
  const description = toSafeDisplayText(fields.Description, '');
  const suggestedMarkup = renderSuggestedMiniCards(suggestedRecords);
  const galleryThumbsMarkup = galleryImages.map((url, index) => `
      <button type="button" class="detail-gallery-thumb${index === 0 ? ' is-active' : ''}" data-image="${url}" aria-label="View image ${index + 1}">
          <img src="${url}" alt="${escapeHtml(title)} image ${index + 1}" loading="lazy" onerror="this.onerror=null;this.src='${IMAGE_FALLBACK_DATA_URI}';" />
      </button>
  `).join('');
  const whatsappNumber = '919860826918';
  const whatsappMsg = encodeURIComponent(
    `Hi, I'm interested in the property: ${title} (${location}) for ${price}`
  );
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${whatsappMsg}`;
  const safeTitle = escapeHtml(title);
  const safeLocation = escapeHtml(location);
  const safePrice = escapeHtml(price);
  const safeDescription = escapeHtml(description);
  const safeImageUrl = escapeHtml(imageUrl);

  return `
        <div class="property-detail-header">
            <img id="detail-primary-image" src="${safeImageUrl}" alt="${safeTitle}" class="property-detail-image" onerror="this.onerror=null;this.src='${IMAGE_FALLBACK_DATA_URI}';" />
            ${galleryImages.length > 1 ? `
              <div class="detail-gallery-thumbs">
                ${galleryThumbsMarkup}
              </div>
            ` : ''}
            <div class="property-detail-info">
                <div class="property-detail-title">${safeTitle}</div>
                <div class="property-detail-location">${safeLocation}</div>
                <div class="property-detail-price">${safePrice}</div>
                ${safeDescription ? `<div class="property-detail-description">${safeDescription}</div>` : ''}
                <div class="property-detail-actions">
                    <button type="button" class="share-cta" id="share-property-btn" aria-label="Share property">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.392 1.19L8.91 13.84A3.12 3.12 0 0 0 9 13a3.12 3.12 0 0 0-.09-.84l6.71-3.36A3 3 0 1 0 15 7a3.12 3.12 0 0 0 .09.84l-6.71 3.36a3 3 0 1 0 0 3.6l6.7 3.35A3 3 0 1 0 18 16z"/></svg>
                    </button>
                    <a href="${whatsappLink}" class="whatsapp-cta" target="_blank" rel="noopener" aria-label="Enquire on WhatsApp" data-lead-type="${encodeURIComponent(title)}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.8 0-65.7-10.8-94.2-30.6l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5c-.1 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>
                    </a>
                </div>
            </div>
        </div>
        ${suggestedRecords.length ? `
          <section class="suggested-mini-section" aria-label="Suggested properties">
            <h3 class="suggested-mini-title">Suggested Properties</h3>
            <div class="suggested-mini-grid">
              ${suggestedMarkup}
            </div>
          </section>
        ` : ''}
    `;
}

async function initPropertyDetail() {
  const container = document.getElementById('property-detail-container');
  const recordId = getRecordIdFromUrl();

  if (!container) return;

  if (!recordId) {
    renderDeadEndState(container, 'Invalid URL: missing property ID.', getListingsPath());
    return;
  }

  container.innerHTML = `
      <div class="loading" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; min-height: 120px; justify-content: center;">
        <div class="spinner" style="border: 4px solid #e2e8f0; border-top: 4px solid #2563eb; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite;"></div>
        <span>Loading property...</span>
      </div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;

  try {
    const { record, records } = await fetchPropertyDetail(recordId);
    updatePropertyPageMetadata(record);
    const suggestedSeed = getSuggestedProperties(records, record, 3);
    const suggestedRecords = await hydrateRecordsWithFreshImages(suggestedSeed);
    container.innerHTML = renderPropertyDetail(record, suggestedRecords);
    bindDetailImageGallery();
    bindShareButton(record);
  } catch (error) {
    const normalized = (error?.message || '').toLowerCase();
    if (normalized.includes('not found')) {
      renderDeadEndState(
        container,
        'This property page was deleted or does not exist anymore.',
        getListingsPath()
      );
      return;
    }

    renderDeadEndState(
      container,
      'Unable to load this page right now. Please browse active listings instead.',
      getListingsPath()
    );
  }
}

document.addEventListener('DOMContentLoaded', initPropertyDetail);
})();
