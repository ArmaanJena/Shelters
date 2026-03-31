const STATIC_LISTINGS_ENDPOINT = '/data/listings.json';
const HERO_FILTER_CACHE_KEY = 'hero_filter_options_v2';
const HERO_FILTER_CACHE_TTL = 10 * 60 * 1000;
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

function getPropertyTypeValue(fields) {
  return fields['Property Type'] || fields.Type || '';
}

function getOfferTypeValue(fields) {
  return fields['Offer Type'] || fields.ListingType || '';
}

function normalizeStaticRecords(payload) {
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function fetchHeroFilterRecords() {
  const cachedRaw = localStorage.getItem(HERO_FILTER_CACHE_KEY);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (
        Date.now() - cached.ts < HERO_FILTER_CACHE_TTL &&
        Array.isArray(cached.records) &&
        cached.records.length > 0
      ) {
        return cached.records || [];
      }
    } catch (error) {
      console.warn('Invalid hero filter cache', error);
    }
  }

  const response = await fetch(STATIC_LISTINGS_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch listings JSON (${response.status})`);
  }

  const payload = await response.json();
  const records = normalizeStaticRecords(payload);
  if (records.length > 0) {
    localStorage.setItem(HERO_FILTER_CACHE_KEY, JSON.stringify({ ts: Date.now(), records }));
  } else {
    localStorage.removeItem(HERO_FILTER_CACHE_KEY);
  }
  return records;
}

function populateSelectOptions(select, values, placeholder) {
  if (!select) return;

  select.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = placeholder;
  select.appendChild(defaultOption);

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

async function hydrateHeroSearchFilters() {
  const propertyTypeSelect = document.querySelector('select[name="propertyType"]');
  const offerTypeSelect = document.querySelector('select[name="offerType"]');
  const locationSelect = document.querySelector('select[name="location"]');

  if (!propertyTypeSelect || !offerTypeSelect || !locationSelect) return;

  try {
    const records = await fetchHeroFilterRecords();
    const uniqueValues = (getter) =>
      [...new Set(
        records
          .map((record) => getter(record.fields || {}))
          .filter((value) => typeof value === 'string' && value.trim())
      )].sort((a, b) => a.localeCompare(b));

    populateSelectOptions(propertyTypeSelect, uniqueValues(getPropertyTypeValue), 'Property Type');
    populateSelectOptions(offerTypeSelect, uniqueValues(getOfferTypeValue), 'Offer Type');
    populateSelectOptions(locationSelect, uniqueValues((fields) => fields.Location || ''), 'Location');
  } catch (error) {
    console.error('Failed to hydrate homepage filters from listings JSON:', error);
  }
}

function getWhatsAppLeadEndpointCandidates() {
  return ['/.netlify/functions/submit-whatsapp-lead', '/submit-whatsapp-lead'];
}

const DIRECT_AIRTABLE_API_KEY =
  'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7';
const DIRECT_AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5';
const DIRECT_AIRTABLE_LEADS_TABLE = 'Leads';

function decodeLeadTypeValue(value) {
  if (!value) return '';
  const stringValue = value.toString().trim();
  if (!stringValue) return '';
  try {
    return decodeURIComponent(stringValue).trim();
  } catch (error) {
    return stringValue;
  }
}

function extractLeadTypeFromWhatsAppUrl(whatsappUrl) {
  if (!whatsappUrl) return '';
  try {
    const parsedUrl = new URL(whatsappUrl, window.location.origin);
    const text = decodeURIComponent(parsedUrl.searchParams.get('text') || '').trim();
    if (!text) return '';

    const fromEnquiryMessage = text.match(/interested in the property:\s*([^\n(]+)/i);
    if (fromEnquiryMessage?.[1]) {
      return fromEnquiryMessage[1].trim();
    }

    const fromShareMessage = text.match(/(?:^|\n)Property:\s*([^\n]+)/i);
    if (fromShareMessage?.[1]) {
      return fromShareMessage[1].trim();
    }
  } catch (error) {
    // Ignore parse errors and fallback to defaults.
  }
  return '';
}

function resolveWhatsAppLeadType(anchor, whatsappUrl) {
  const explicitLeadType = decodeLeadTypeValue(anchor?.dataset?.leadType);
  if (explicitLeadType) return explicitLeadType;

  const inferredLeadType = extractLeadTypeFromWhatsAppUrl(whatsappUrl);
  if (inferredLeadType) return inferredLeadType;

  return 'General Enquiry';
}

async function submitWhatsAppLeadDirectToAirtable(payload) {
  const istTimestamp = `${new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(new Date())} IST`;
  const url = `https://api.airtable.com/v0/${DIRECT_AIRTABLE_BASE_ID}/${encodeURIComponent(DIRECT_AIRTABLE_LEADS_TABLE)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DIRECT_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      records: [
        {
          fields: {
            Name: payload.name,
            Phone: payload.phone,
            Message: [payload.message || '', `Timestamp: ${istTimestamp}`].filter(Boolean).join('\n'),
            'Lead Property': payload.leadType || 'General Enquiry'
          }
        }
      ]
    })
  });
  return response.ok;
}

async function submitWhatsAppLead(payload) {
  const endpoints = getWhatsAppLeadEndpointCandidates();
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) return true;
    } catch (error) {
      // Try next endpoint.
    }
  }

  try {
    return await submitWhatsAppLeadDirectToAirtable(payload);
  } catch (error) {
    return false;
  }
}

function buildWhatsAppLeadModal() {
  const existing = document.getElementById('whatsapp-lead-overlay');
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.id = 'whatsapp-lead-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(2,6,23,0.58);display:none;align-items:center;justify-content:center;z-index:13000;padding:1rem;';
  overlay.innerHTML = `
    <div style="width:min(460px,96vw);background:#fff;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 20px 50px rgba(2,6,23,0.28);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.9rem 1rem;border-bottom:1px solid #e2e8f0;">
        <h3 style="margin:0;font-size:1.15rem;color:#0f172a;">Continue to WhatsApp</h3>
        <button type="button" id="whatsapp-lead-close" aria-label="Close" style="border:none;background:transparent;font-size:1.5rem;line-height:1;cursor:pointer;color:#334155;">&times;</button>
      </div>
      <form id="whatsapp-lead-form" style="padding:1rem;display:flex;flex-direction:column;gap:0.75rem;">
        <label style="display:flex;flex-direction:column;gap:0.35rem;font-size:0.92rem;color:#334155;">
          Name *
          <input type="text" name="name" required maxlength="120" style="padding:0.62rem 0.7rem;border:1px solid #cbd5e1;border-radius:10px;font:inherit;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.35rem;font-size:0.92rem;color:#334155;">
          Phone *
          <input type="tel" name="phone" required maxlength="30" style="padding:0.62rem 0.7rem;border:1px solid #cbd5e1;border-radius:10px;font:inherit;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.35rem;font-size:0.92rem;color:#334155;">
          Message
          <textarea name="message" rows="3" maxlength="500" style="padding:0.62rem 0.7rem;border:1px solid #cbd5e1;border-radius:10px;font:inherit;resize:vertical;"></textarea>
        </label>
        <p id="whatsapp-lead-status" style="margin:0;min-height:1.1rem;font-size:0.86rem;color:#64748b;"></p>
        <button type="submit" id="whatsapp-lead-submit" style="border:none;border-radius:10px;padding:0.72rem 0.9rem;background:#25D366;color:#fff;font-weight:700;cursor:pointer;">
          Continue to WhatsApp
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

function initWhatsAppLeadFlow() {
  const overlay = buildWhatsAppLeadModal();
  const form = overlay.querySelector('#whatsapp-lead-form');
  const statusNode = overlay.querySelector('#whatsapp-lead-status');
  const closeBtn = overlay.querySelector('#whatsapp-lead-close');
  const submitBtn = overlay.querySelector('#whatsapp-lead-submit');

  let pendingWhatsAppUrl = '';
  let pendingLeadType = 'General Enquiry';

  const closeModal = () => {
    overlay.style.display = 'none';
    pendingWhatsAppUrl = '';
    pendingLeadType = 'General Enquiry';
    form.reset();
    statusNode.textContent = '';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Continue to WhatsApp';
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href*="wa.me/"]');
    if (!anchor || anchor.dataset.skipLeadCapture === 'true') return;
    event.preventDefault();
    pendingWhatsAppUrl = anchor.href;
    pendingLeadType = resolveWhatsAppLeadType(anchor, pendingWhatsAppUrl);
    overlay.style.display = 'flex';
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) nameInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pendingWhatsAppUrl) return;

    const formData = new FormData(form);
    const name = (formData.get('name') || '').toString().trim();
    const phone = (formData.get('phone') || '').toString().trim();
    const message = (formData.get('message') || '').toString().trim();

    if (!name || !phone) {
      statusNode.textContent = 'Please enter name and phone.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait...';
    statusNode.textContent = 'Saving lead...';

    const originalUrl = new URL(pendingWhatsAppUrl);
    const existingText = decodeURIComponent(originalUrl.searchParams.get('text') || '');
    const leadText = [
      existingText,
      '',
      `Name: ${name}`,
      `Phone: ${phone}`,
      message ? `Message: ${message}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    originalUrl.searchParams.set('text', leadText);
    const nextWhatsAppUrl = originalUrl.toString();

    const saved = await submitWhatsAppLead({
      name,
      phone,
      message,
      leadType: pendingLeadType,
      source: 'WhatsApp CTA',
      pageUrl: window.location.href,
      whatsappUrl: pendingWhatsAppUrl
    });

    if (!saved) {
      statusNode.textContent = 'Could not save lead right now. Please try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to WhatsApp';
      return;
    }

    statusNode.textContent = 'Redirecting to WhatsApp...';
    window.open(nextWhatsAppUrl, '_blank', 'noopener');
    closeModal();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const searchTabs = document.querySelectorAll('.search-tab-btn');
  const searchContents = document.querySelectorAll('.search-panel .search-form');

  searchTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      searchTabs.forEach((activeTab) => activeTab.classList.remove('active'));
      searchContents.forEach((content) => {
        content.classList.remove('active');
        content.style.display = 'none';
      });

      tab.classList.add('active');
      const tabId = tab.dataset.tab;
      const activeContent = document.getElementById(`${tabId}-form`);
      if (activeContent) {
        activeContent.classList.add('active');
        activeContent.style.display = 'flex';
      }
    });
  });

  const findForm = document.getElementById('find-form');
  if (findForm) {
    hydrateHeroSearchFilters();
    findForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(findForm);
      const params = new URLSearchParams();

      for (const [key, value] of formData.entries()) {
        if (value) params.append(key, value);
      }

      window.location.href = `listings.html?${params.toString()}`;
    });
  }

  const navToggle = document.getElementById('nav-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('active');
      navMenu.classList.toggle('active');
    });
  }

  const themeToggle = document.getElementById('theme-toggle');
  const htmlEl = document.documentElement;

  function setTheme(theme) {
    if (theme === 'dark') {
      htmlEl.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      htmlEl.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      if (htmlEl.classList.contains('dark-mode')) {
        setTheme('light');
      } else {
        setTheme('dark');
      }
    });
  }

  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (savedTheme) {
    setTheme(savedTheme);
  } else if (prefersDark) {
    setTheme('dark');
  }

  initWhatsAppLeadFlow();
});
