const FEATURED_LISTINGS_ENDPOINT = '/data/listings.json';
const FEATURED_CACHE_KEY = 'managed_listings_cache_v5';
const FEATURED_CACHE_TTL = 10 * 60 * 1000;
const FEATURED_IMAGE_REFRESH_CACHE_KEY = 'featured_image_refresh_v1';
const FEATURED_IMAGE_REFRESH_TTL = 6 * 60 * 60 * 1000;
const AIRTABLE_API_KEY =
  'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7';
const AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5';
const AIRTABLE_PROPERTIES_TABLE_NAME = 'Properties';
const AIRTABLE_PROPERTIES_ENDPOINT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_PROPERTIES_TABLE_NAME)}`;
const CARD_IMAGE_FALLBACK =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20800%20500%22%3E%3Crect%20width%3D%22800%22%20height%3D%22500%22%20fill%3D%22%23cbd5e1%22/%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%23334155%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2232%22%3EImage%20Unavailable%3C/text%3E%3C/svg%3E';

function isRecentlyAdded(createdTime, days = 7) {
  const createdAt = new Date(createdTime || 0).getTime();
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  return Date.now() - createdAt <= days * 24 * 60 * 60 * 1000;
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
    card: large || small || full,
    full: full || large || small
  };
}

function normalizePayloadRecords(payload) {
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload)) return payload;
  return [];
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

function getImageRefreshCache() {
  const cachedRaw = localStorage.getItem(FEATURED_IMAGE_REFRESH_CACHE_KEY);
  if (!cachedRaw) return {};
  try {
    const parsed = JSON.parse(cachedRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    console.warn('Invalid featured image refresh cache', error);
  }
  return {};
}

function setImageRefreshCache(cache) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
    localStorage.removeItem(FEATURED_IMAGE_REFRESH_CACHE_KEY);
    return;
  }
  localStorage.setItem(FEATURED_IMAGE_REFRESH_CACHE_KEY, JSON.stringify(cache));
}

function getCachedRefreshedImages(recordId) {
  if (!recordId) return [];
  const cache = getImageRefreshCache();
  const entry = cache[recordId];
  if (!entry || !Array.isArray(entry.images)) return [];
  if (Date.now() - Number(entry.ts || 0) > FEATURED_IMAGE_REFRESH_TTL) return [];
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
  const cache = getImageRefreshCache();
  cache[recordId] = { ts: Date.now(), images: normalized };
  setImageRefreshCache(cache);
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

async function fetchFreshRecordFromAirtable(recordId) {
  if (!recordId || !AIRTABLE_API_KEY) return null;
  const endpoint = `${AIRTABLE_PROPERTIES_ENDPOINT}/${encodeURIComponent(recordId)}`;
  const response = await fetch(endpoint, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload && typeof payload === 'object' ? payload : null;
}

async function fetchFreshImageMapFromAirtable() {
  if (!AIRTABLE_API_KEY) return new Map();
  const imageMap = new Map();
  let offset = '';

  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    if (offset) params.set('offset', offset);

    const response = await fetch(`${AIRTABLE_PROPERTIES_ENDPOINT}?${params.toString()}`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) break;

    const payload = await response.json();
    const records = Array.isArray(payload?.records) ? payload.records : [];
    records.forEach((record) => {
      const managedValue = record?.fields?.Managed ?? record?.fields?.['Managed '];
      const managed = managedValue === true || managedValue === 'true';
      if (!managed) return;
      const images = normalizeImageAttachments(record?.fields?.Image);
      if (record?.id && images.length > 0) {
        imageMap.set(record.id, images);
      }
    });

    offset = payload?.offset || '';
  } while (offset);

  return imageMap;
}

async function ensureRecordHasFreshImages(record) {
  if (!record || !shouldRefreshRecordImages(record)) return record;

  const cachedImages = getCachedRefreshedImages(record.id);
  if (cachedImages.length > 0) {
    return cloneRecordWithImages(record, cachedImages);
  }

  try {
    const freshRecord = await fetchFreshRecordFromAirtable(record.id);
    const freshImages = normalizeImageAttachments(freshRecord?.fields?.Image);
    if (freshImages.length > 0) {
      cacheRefreshedImages(record.id, freshImages);
      return cloneRecordWithImages(record, freshImages);
    }
  } catch (error) {
    console.warn('Unable to refresh featured listing images from Airtable', error);
  }

  return record;
}

async function hydrateManagedRecordImages(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const hydrated = [...records];
  const pendingIndexes = [];

  for (let index = 0; index < hydrated.length; index += 1) {
    const record = hydrated[index];
    const fields = record?.fields || {};
    const managedValue = fields.Managed ?? fields['Managed '];
    const managed = managedValue === true || managedValue === 'true';
    const shouldRefresh = shouldRefreshRecordImages(record);
    const shouldWarmAirtable = hasAirtableHostedImages(record);
    if (!managed || (!shouldRefresh && !shouldWarmAirtable)) continue;

    const cachedImages = getCachedRefreshedImages(record.id);
    if (cachedImages.length > 0) {
      hydrated[index] = cloneRecordWithImages(record, cachedImages);
      continue;
    }

    pendingIndexes.push(index);
  }

  if (pendingIndexes.length === 0) return hydrated;

  try {
    const freshImageMap = await fetchFreshImageMapFromAirtable();
    pendingIndexes.forEach((index) => {
      const record = hydrated[index];
      const freshImages = freshImageMap.get(record?.id);
      if (!freshImages || freshImages.length === 0) return;
      cacheRefreshedImages(record.id, freshImages);
      hydrated[index] = cloneRecordWithImages(record, freshImages);
    });
    return hydrated;
  } catch (error) {
    console.warn('Failed to hydrate featured record images', error);
    return Promise.all(
      hydrated.map(async (record) => {
        try {
          return await ensureRecordHasFreshImages(record);
        } catch (innerError) {
          console.warn('Fallback featured image hydration failed', innerError);
          return record;
        }
      })
    );
  }
}

async function fetchManagedListingsFromStatic() {
  const cachedRaw = localStorage.getItem(FEATURED_CACHE_KEY);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (
        Date.now() - cached.ts < FEATURED_CACHE_TTL &&
        Array.isArray(cached.records) &&
        cached.records.length > 0
      ) {
        const hydratedCached = await hydrateManagedRecordImages(cached.records || []);
        if (Array.isArray(hydratedCached) && hydratedCached.length > 0) {
          localStorage.setItem(FEATURED_CACHE_KEY, JSON.stringify({ ts: Date.now(), records: hydratedCached }));
          return hydratedCached;
        }
        return cached.records || [];
      }
    } catch (error) {
      console.warn('Invalid managed listings cache', error);
    }
  }

  const response = await fetch(FEATURED_LISTINGS_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch managed listings (${response.status})`);
  }

  const payload = await response.json();
  const records = await hydrateManagedRecordImages(normalizePayloadRecords(payload));
  if (records.length > 0) {
    localStorage.setItem(FEATURED_CACHE_KEY, JSON.stringify({ ts: Date.now(), records }));
  } else {
    localStorage.removeItem(FEATURED_CACHE_KEY);
  }
  return records;
}

function normalizeManagedListing(record) {
  const fields = record.fields || {};
  const imageField = fields.Image;
  const managedValue = fields.Managed ?? fields['Managed '];
  const firstImage = Array.isArray(imageField) ? imageField[0] : null;
  const imageSources = getAttachmentImageSources(firstImage);
  const imageUrl = imageSources.card || '';
  const imageFullUrl = imageSources.full || imageUrl;

  return {
    id: record.id,
    title: fields.Title || 'Untitled',
    location: fields.Location || 'Unknown',
    price: Number(fields.Price) || 0,
    listingType: fields.ListingType || fields['Offer Type'] || 'Property',
    description:
      fields['Short Description'] ||
      fields.Description ||
      fields.Type ||
      fields['Property Type'] ||
      'Managed property',
    image:
      imageUrl ||
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
    imageFull: imageFullUrl,
    managed: managedValue === true || managedValue === 'true',
    isNew: isRecentlyAdded(record.createdTime, 7)
  };
}

function createManagedListingCard(listing) {
  const price = listing.price > 0 ? `₹${listing.price.toLocaleString('en-IN')}` : 'Price on request';
  const imageSrcSet =
    listing.imageFull && listing.imageFull !== listing.image
      ? `${listing.image} 1x, ${listing.imageFull} 2x`
      : '';

  return `
    <div class="bento-card-wrapper">
      <a href="/property-detail?id=${listing.id}" class="bento-card">
        <div class="listing-image-container">
          <img src="${listing.image}" ${imageSrcSet ? `srcset="${imageSrcSet}" sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"` : ''} alt="${listing.title}" loading="lazy" decoding="async" fetchpriority="low" onerror="this.onerror=null;this.src='${CARD_IMAGE_FALLBACK}';">
          <div class="bento-badge">${listing.listingType}</div>
          ${listing.isNew ? '<div class="bento-badge bento-badge-new">New</div>' : ''}
        </div>
        <div class="bento-content">
          <h3 class="bento-title">${listing.title}</h3>
          <p class="bento-location">📍 ${listing.location}</p>
          <p class="bento-description">${listing.description}</p>
          <div class="bento-price">${price}</div>
        </div>
      </a>
    </div>
  `;
}

function buildSlides(listings, itemsPerSlide) {
  const slides = [];
  for (let index = 0; index < listings.length; index += itemsPerSlide) {
    slides.push(listings.slice(index, index + itemsPerSlide));
  }
  return slides;
}

document.addEventListener('DOMContentLoaded', async () => {
  const featuredContainer = document.getElementById('featured-listings-grid');
  if (!featuredContainer) return;

  try {
    const records = await fetchManagedListingsFromStatic();
    const managedListings = records.map(normalizeManagedListing).filter((listing) => listing.managed);

    if (managedListings.length === 0) {
      featuredContainer.innerHTML = '<p>No managed properties available at the moment.</p>';
      return;
    }

    const slides = buildSlides(managedListings, 3);

    featuredContainer.innerHTML = `
      <div class="featured-carousel">
        <div class="featured-carousel-viewport">
          <div class="featured-carousel-track">
            ${slides
              .map(
                (slide) => `
              <div class="featured-carousel-slide">
                <div class="bento-grid featured-slide-grid">
                  ${slide.map(createManagedListingCard).join('')}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
      <div class="featured-carousel-dots">
        ${slides
          .map(
            (_, index) =>
              `<button type="button" class="featured-carousel-dot${
                index === 0 ? ' is-active' : ''
              }" data-index="${index}" aria-label="Go to slide ${index + 1}"></button>`
          )
          .join('')}
      </div>
    `;

    if (slides.length === 1) {
      const dots = featuredContainer.querySelector('.featured-carousel-dots');
      if (dots) dots.style.display = 'none';
      return;
    }

    let activeIndex = 0;
    const track = featuredContainer.querySelector('.featured-carousel-track');
    const dots = [...featuredContainer.querySelectorAll('.featured-carousel-dot')];

    const updateSlide = (index) => {
      activeIndex = (index + slides.length) % slides.length;
      track.style.transform = `translateX(-${activeIndex * 100}%)`;
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('is-active', dotIndex === activeIndex);
      });
    };

    dots.forEach((dot) => {
      dot.addEventListener('click', () => updateSlide(Number(dot.dataset.index)));
    });
  } catch (error) {
    console.error('Failed to render managed listings carousel:', error);
    featuredContainer.innerHTML = '<p>Unable to load managed properties right now.</p>';
  }
});
