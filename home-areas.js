const HOME_FEATURED_AREAS_GRID_ID = 'featured-areas-grid';
const HOME_AREAS_CACHE_KEY = 'home_featured_areas_cache_v1';
const HOME_AREAS_CACHE_TTL = 10 * 60 * 1000;
const HOME_AREAS_DEFAULT_LIMIT = 3;
const HOME_LISTINGS_ENDPOINT = '/data/listings.json';
const HOME_AIRTABLE_API_KEY =
  'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7';
const HOME_AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5';
const HOME_AREAS_TABLE_NAME = 'Areas';
const HOME_AREA_QUESTIONS_TABLE_NAME = 'Areas Questions';

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

async function fetchAirtableTableRecords(tableName, fields = []) {
  const endpoint = `https://api.airtable.com/v0/${HOME_AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
  const records = [];
  let offset = '';

  do {
    const url = new URL(endpoint);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    fields.forEach((fieldName) => url.searchParams.append('fields[]', fieldName));

    const response = await fetch(url.toString(), {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${HOME_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${tableName} (${response.status})`);
    }

    const payload = await response.json();
    records.push(...(payload.records || []));
    offset = payload.offset || '';
  } while (offset);

  return records;
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

  return [...explicitlyFeatured, ...nonFeatured].slice(0, HOME_AREAS_DEFAULT_LIMIT);
}

async function fetchAreasFromListings() {
  const response = await fetch(`${HOME_LISTINGS_ENDPOINT}?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return [];
  const payload = await response.json();
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
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, HOME_AREAS_DEFAULT_LIMIT);
}

function buildHomeAreaCard(item) {
  const link = `/areas/?area=${encodeURIComponent(item.name)}`;
  const fallbackDescription = `Explore properties, trends, and neighbourhood insights in ${item.name}.`;
  const description = (item.description || fallbackDescription).slice(0, 190);

  return `
    <a href="${link}" class="collection-card" aria-label="Explore ${homeAreasEscapeHtml(item.name)} area">
      <h3>${homeAreasEscapeHtml(item.name)}</h3>
      <p>${homeAreasEscapeHtml(description)}</p>
      <div class="collection-glow"></div>
    </a>
  `;
}

function renderHomeAreas(items) {
  const grid = document.getElementById(HOME_FEATURED_AREAS_GRID_ID);
  if (!grid) return;

  if (!Array.isArray(items) || items.length === 0) {
    grid.innerHTML = `
      <a href="/areas" class="collection-card" aria-label="Explore all areas">
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
  const cachedItems = getHomeAreasCache();
  if (cachedItems && cachedItems.length > 0) {
    renderHomeAreas(cachedItems);
  }

  let areas = [];
  try {
    const areaRecords = await fetchAirtableTableRecords(HOME_AREAS_TABLE_NAME);
    areas = areaRecords
      .map((record) => normalizeAreaRecord(record, 'areas'))
      .filter(Boolean);
  } catch (error) {
    console.warn('Unable to load Areas table, falling back to Areas Questions:', error);
  }

  if (areas.length === 0) {
    try {
      const areaQuestionRecords = await fetchAirtableTableRecords(HOME_AREA_QUESTIONS_TABLE_NAME, [
        'Location',
        'Area Description'
      ]);
      areas = areaQuestionRecords
        .map((record) => normalizeAreaRecord(record, 'area_questions'))
        .filter(Boolean);
    } catch (error) {
      console.warn('Unable to load Areas Questions table:', error);
    }
  }

  if (areas.length === 0) {
    try {
      areas = await fetchAreasFromListings();
    } catch (error) {
      console.warn('Unable to build areas from listings fallback:', error);
    }
  }

  const featuredAreas = pickFeaturedAreas(areas);
  renderHomeAreas(featuredAreas);
  if (featuredAreas.length > 0) setHomeAreasCache(featuredAreas);
}

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById(HOME_FEATURED_AREAS_GRID_ID);
  if (!grid) return;

  loadHomeAreas().catch((error) => {
    console.error('Failed to load featured areas:', error);
  });
});
