const HOME_FEATURED_AREAS_GRID_ID = 'featured-areas-grid';
const HOME_AREAS_CACHE_KEY = 'home_featured_areas_cache_v2';
const HOME_AREAS_CACHE_TTL = 10 * 60 * 1000;
const HOME_LISTINGS_ENDPOINT = 'data/listings.json';
const HOME_AREAS_ENDPOINT = 'data/areas.json';
const HOME_AREA_QUESTIONS_ENDPOINT = 'data/area-questions.json';
const HOME_JSON_FETCH_TIMEOUT_MS = 15000;
const HOME_SLOW_LOAD_NOTICE_MS = 2500;

function classifyHomeFetchFailure(error) {
  if (error?.name === 'AbortError') {
    return `Timeout while loading JSON (${HOME_JSON_FETCH_TIMEOUT_MS}ms).`;
  }
  if (error instanceof TypeError) {
    return 'Network failure while loading JSON.';
  }
  return (error?.message || 'Unknown JSON fetch failure.').toString();
}

function homeAreasEscapeHtml(value) {
  return (value || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function getHomeAreasEntryPath() {
  const path = window.location.pathname || '/';
  return /\.html$/i.test(path) ? './areas.html' : './areas/';
}

function buildHomeAreasLink(areaName) {
  const slug = toAreaSlug(areaName);
  if (!slug) return getHomeAreasEntryPath();
  return `${getHomeAreasEntryPath()}?area=${encodeURIComponent(slug)}`;
}

function normalizeAreaName(fields) {
  const candidates = [
    fields?.['Area Name'],
    fields?.Location,
    fields?.Name,
    fields?.Title,
    fields?.Area
  ];
  const value = candidates.find((item) => typeof item === 'string' && item.trim());
  return (value || '').toString().trim();
}

function normalizeAreaDescription(fields) {
  const candidates = [
    fields?.['Area Description'],
    fields?.Description,
    fields?.Summary,
    fields?.About
  ];
  const value = candidates.find((item) => typeof item === 'string' && item.trim());
  if (!value) return '';
  return value.toString().replace(/\s+/g, ' ').trim();
}

function normalizeFeaturedFlag(fields) {
  const value =
    fields?.Featured ??
    fields?.['Featured on Home'] ??
    fields?.['Show on Home'] ??
    fields?.['Is Featured'];
  return value === true || value === 'true' || value === 'Yes';
}

function normalizeRank(fields) {
  const value = Number(fields?.Order ?? fields?.Rank ?? fields?.Priority ?? 9999);
  return Number.isFinite(value) ? value : 9999;
}

function normalizeAreaRecord(record, source) {
  const fields = record?.fields || {};
  const name = normalizeAreaName(fields);
  if (!name) return null;

  return {
    id: record?.id || '',
    name,
    description: normalizeAreaDescription(fields),
    featured: normalizeFeaturedFlag(fields),
    rank: normalizeRank(fields),
    source
  };
}

function getHomeAreasCache() {
  const raw = localStorage.getItem(HOME_AREAS_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.items) &&
      Date.now() - Number(parsed.ts || 0) < HOME_AREAS_CACHE_TTL
    ) {
      return parsed.items;
    }
  } catch (error) {
    console.warn('Invalid home areas cache payload', error);
  }
  return null;
}

function setHomeAreasCache(items) {
  if (!Array.isArray(items)) return;
  localStorage.setItem(
    HOME_AREAS_CACHE_KEY,
    JSON.stringify({
      ts: Date.now(),
      items
    })
  );
}

function normalizePayloadRecords(payload) {
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function fetchStaticTableRecords(endpoint) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HOME_JSON_FETCH_TIMEOUT_MS);
  let payload;
  try {
    const response = await fetch(`${endpoint}?ts=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Invalid response (${response.status}) for ${endpoint}.`);
    }
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Invalid JSON payload for ${endpoint}.`);
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
  return normalizePayloadRecords(payload);
}

function pickFeaturedAreas(items) {
  const deduped = new Map();
  items.forEach((item) => {
    if (!item?.name) return;
    const key = item.name.toLowerCase();
    if (!deduped.has(key)) deduped.set(key, item);
  });

  const uniqueItems = [...deduped.values()];
  const explicitlyFeatured = uniqueItems
    .filter((item) => item.featured)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const nonFeatured = uniqueItems
    .filter((item) => !item.featured)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  return [...explicitlyFeatured, ...nonFeatured];
}

async function fetchAreasFromListings() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HOME_JSON_FETCH_TIMEOUT_MS);
  let payload;
  try {
    const response = await fetch(`${HOME_LISTINGS_ENDPOINT}?ts=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) return [];
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Invalid JSON payload for ${HOME_LISTINGS_ENDPOINT}.`);
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
  const records = Array.isArray(payload?.records) ? payload.records : Array.isArray(payload) ? payload : [];
  const areasMap = new Map();

  records.forEach((record) => {
    const location = (record?.fields?.Location || '').toString().trim();
    if (!location) return;
    const key = location.toLowerCase();
    if (!areasMap.has(key)) {
      areasMap.set(key, {
        id: record?.id || key,
        name: location,
        description: '',
        featured: false,
        rank: 9999,
        source: 'listings'
      });
    }
  });

  return [...areasMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildHomeAreaCard(item) {
  const link = buildHomeAreasLink(item.name);

  return `
    <a href="${link}" class="collection-card" aria-label="Open ${homeAreasEscapeHtml(item.name)} listings">
      <h3>${homeAreasEscapeHtml(item.name)}</h3>
      <p>Open ${homeAreasEscapeHtml(item.name)} listings</p>
      <div class="collection-glow"></div>
    </a>
  `;
}

function renderHomeAreas(items) {
  const grid = document.getElementById(HOME_FEATURED_AREAS_GRID_ID);
  if (!grid) return;

  if (!Array.isArray(items) || items.length === 0) {
    grid.innerHTML = `
      <a href="${getHomeAreasEntryPath()}" class="collection-card" aria-label="Explore all areas">
        <h3>Explore Areas</h3>
        <p>Area information is being updated. Visit the areas page to view available locations.</p>
        <div class="collection-glow"></div>
      </a>
    `;
    return;
  }

  grid.innerHTML = items.map(buildHomeAreaCard).join('');
}

async function loadHomeAreas() {
  const grid = document.getElementById(HOME_FEATURED_AREAS_GRID_ID);
  let slowNoticeTimer = null;
  if (grid) {
    slowNoticeTimer = window.setTimeout(() => {
      if (!grid.querySelector('.collection-card')) {
        grid.innerHTML = `
          <a href="${getHomeAreasEntryPath()}" class="collection-card" aria-label="Explore all areas">
            <h3>Loading Areas</h3>
            <p>Area data is taking longer than expected. Please wait or open the areas page.</p>
            <div class="collection-glow"></div>
          </a>
        `;
      }
    }, HOME_SLOW_LOAD_NOTICE_MS);
  }

  const cachedItems = getHomeAreasCache();
  if (cachedItems && cachedItems.length > 0) {
    renderHomeAreas(cachedItems);
  }

  let areas = [];
  let areaQuestions = [];

  try {
    const areaRecords = await fetchStaticTableRecords(HOME_AREAS_ENDPOINT);
    areas = areaRecords
      .map((record) => normalizeAreaRecord(record, 'areas'))
      .filter(Boolean);
  } catch (error) {
    console.warn('Unable to load areas static data:', classifyHomeFetchFailure(error));
  }

  try {
    const areaQuestionRecords = await fetchStaticTableRecords(HOME_AREA_QUESTIONS_ENDPOINT);
    areaQuestions = areaQuestionRecords
      .map((record) => normalizeAreaRecord(record, 'area_questions'))
      .filter(Boolean);
  } catch (error) {
    console.warn('Unable to load area-questions static data:', classifyHomeFetchFailure(error));
  }

  // Merge both tables so homepage is not limited by whichever table has fewer rows.
  const mergedMap = new Map();
  [...areas, ...areaQuestions].forEach((item) => {
    if (!item?.name) return;
    const key = item.name.toLowerCase();
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
      return;
    }

    const existing = mergedMap.get(key);
    const existingHasDescription = Boolean(existing?.description?.trim());
    const incomingHasDescription = Boolean(item?.description?.trim());
    if (!existingHasDescription && incomingHasDescription) {
      mergedMap.set(key, { ...existing, ...item });
    }
  });

  const mergedAreas = [...mergedMap.values()];

  if (mergedAreas.length > 0) {
    areas = mergedAreas;
  }

  if (areas.length === 0) {
    try {
      areas = await fetchAreasFromListings();
    } catch (error) {
      console.warn('Unable to build areas from listings fallback:', classifyHomeFetchFailure(error));
    }
  }

  const featuredAreas = pickFeaturedAreas(areas);
  renderHomeAreas(featuredAreas);
  if (slowNoticeTimer) window.clearTimeout(slowNoticeTimer);
  if (featuredAreas.length > 0) setHomeAreasCache(featuredAreas);
}

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById(HOME_FEATURED_AREAS_GRID_ID);
  if (!grid) return;

  loadHomeAreas().catch((error) => {
    console.error('Failed to load featured areas:', error);
  });
});
