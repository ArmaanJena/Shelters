const FEATURED_AIRTABLE_API_KEY = 'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7';
const FEATURED_AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5';
const FEATURED_AIRTABLE_TABLE_NAME = 'Properties';
const FEATURED_AIRTABLE_ENDPOINT = `https://api.airtable.com/v0/${FEATURED_AIRTABLE_BASE_ID}/${FEATURED_AIRTABLE_TABLE_NAME}`;
const FEATURED_CACHE_KEY = 'managed_listings_cache_v1';
const FEATURED_CACHE_TTL = 10 * 60 * 1000;

async function fetchManagedListingsFromAirtable() {
  const cachedRaw = localStorage.getItem(FEATURED_CACHE_KEY);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (Date.now() - cached.ts < FEATURED_CACHE_TTL) {
        return cached.records || [];
      }
    } catch (error) {
      console.warn('Invalid managed listings cache', error);
    }
  }

  const allRecords = [];
  let offset = '';

  do {
    const url = new URL(FEATURED_AIRTABLE_ENDPOINT);
    if (offset) url.searchParams.set('offset', offset);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${FEATURED_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch managed listings (${response.status})`);
    }

    const data = await response.json();
    allRecords.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);

  localStorage.setItem(FEATURED_CACHE_KEY, JSON.stringify({ ts: Date.now(), records: allRecords }));
  return allRecords;
}

function normalizeManagedListing(record) {
  const fields = record.fields || {};
  const imageField = fields.Image;
  const managedValue = fields.Managed ?? fields['Managed '];
  const imageUrl = Array.isArray(imageField)
    ? imageField[0]?.url || imageField[0]?.thumbnails?.large?.url || ''
    : '';

  return {
    id: record.id,
    title: fields.Title || 'Untitled',
    location: fields.Location || 'Unknown',
    price: Number(fields.Price) || 0,
    listingType: fields.ListingType || fields['Offer Type'] || 'Property',
    description: fields['Short Description'] || fields.Description || fields.Type || fields['Property Type'] || 'Managed property',
    image: imageUrl || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
    managed: managedValue === true || managedValue === 'true'
  };
}

function createManagedListingCard(listing) {
  const price = listing.price > 0 ? `₹${listing.price.toLocaleString('en-IN')}` : 'Price on request';

  return `
    <div class="bento-card-wrapper">
      <a href="property-detail.html?id=${listing.id}" class="bento-card">
        <div class="listing-image-container">
          <img src="${listing.image}" alt="${listing.title}" loading="lazy">
          <div class="bento-badge">${listing.listingType}</div>
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
    const records = await fetchManagedListingsFromAirtable();
    const managedListings = records
      .map(normalizeManagedListing)
      .filter((listing) => listing.managed);

    if (managedListings.length === 0) {
      featuredContainer.innerHTML = '<p>No managed properties available at the moment.</p>';
      return;
    }

    const slides = buildSlides(managedListings, 3);

    featuredContainer.innerHTML = `
      <div class="featured-carousel">
        <button type="button" class="featured-carousel-control prev" aria-label="Previous slide">‹</button>
        <div class="featured-carousel-viewport">
          <div class="featured-carousel-track">
            ${slides.map((slide) => `
              <div class="featured-carousel-slide">
                <div class="bento-grid featured-slide-grid">
                  ${slide.map(createManagedListingCard).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <button type="button" class="featured-carousel-control next" aria-label="Next slide">›</button>
      </div>
      <div class="featured-carousel-dots">
        ${slides.map((_, index) => `<button type="button" class="featured-carousel-dot${index === 0 ? ' is-active' : ''}" data-index="${index}" aria-label="Go to slide ${index + 1}"></button>`).join('')}
      </div>
    `;

    if (slides.length === 1) {
      const prev = featuredContainer.querySelector('.featured-carousel-control.prev');
      const next = featuredContainer.querySelector('.featured-carousel-control.next');
      const dots = featuredContainer.querySelector('.featured-carousel-dots');
      if (prev) prev.style.display = 'none';
      if (next) next.style.display = 'none';
      if (dots) dots.style.display = 'none';
      return;
    }

    let activeIndex = 0;
    const track = featuredContainer.querySelector('.featured-carousel-track');
    const dots = [...featuredContainer.querySelectorAll('.featured-carousel-dot')];
    const prevButton = featuredContainer.querySelector('.featured-carousel-control.prev');
    const nextButton = featuredContainer.querySelector('.featured-carousel-control.next');

    const updateSlide = (index) => {
      activeIndex = (index + slides.length) % slides.length;
      track.style.transform = `translateX(-${activeIndex * 100}%)`;
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('is-active', dotIndex === activeIndex);
      });
    };

    prevButton.addEventListener('click', () => updateSlide(activeIndex - 1));
    nextButton.addEventListener('click', () => updateSlide(activeIndex + 1));
    dots.forEach((dot) => {
      dot.addEventListener('click', () => updateSlide(Number(dot.dataset.index)));
    });
  } catch (error) {
    console.error('Failed to render managed listings carousel:', error);
    featuredContainer.innerHTML = '<p>Unable to load managed properties right now.</p>';
  }
});
