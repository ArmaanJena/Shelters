// listings cache helper — stores listings.json for 10 minutes to save backend ops
async function fetchListings() {
  const CACHE_KEY = 'listings_cache_v1';
  const TTL = 10 * 60 * 1000; // 10 minutes
  try {
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (Date.now() - cached.ts < TTL) {
        return cached.data;
      }
    }
    const res = await fetch('/data/listings.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Network response not ok ' + res.status);
    const data = await res.json();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (err) {
    console.error('fetchListings error', err);
    // fallback to cached if available
    const fallback = localStorage.getItem(CACHE_KEY);
    if (fallback) return JSON.parse(fallback).data;
    return { records: [] };
  }
}

// featured-listings.js

document.addEventListener('DOMContentLoaded', () => {
    const featuredContainer = document.getElementById('featured-listings-grid');

    if (!featuredContainer) {
        console.error('Error: The container element with id "featured-listings-grid" was not found.');
        return;
    }

    /**
     * Creates an HTML card for a single property listing.
     * @param {object} listing - The property data object from Airtable.
     * @returns {string} The HTML string for the property card.
     */
    const createListingCard = (listing) => {
        // The listing object here is the transformed one from get-listings.js

        const priceFormatted = typeof listing.price === 'number' && listing.price > 0
            ? `₹${listing.price.toLocaleString('en-IN')}`
            : 'Price on request';
        
        const imageUrl = listing.image && listing.image.length > 0 ? listing.image : 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=400&q=80';

        // Intelligently select the first available description
        const description = listing.propertyTypeDescription || listing.offerTypeDescription || listing.locationDescription || '';

        return `
            <div class="bento-card-wrapper">
                <a href="property-detail.html?id=${listing.listingId}" class="bento-card">
                    <div class="listing-image-container">
                        <img data-src="${imageUrl}" alt="${listing.title || 'Property image'}" class="lazy-image">
                        <div class="bento-badge">${listing.offerType}</div>
                    </div>
                    <div class="listing-content">
                        <h3 class="bento-title">${listing.title || 'N/A'}</h3>
                        <p class="bento-location">📍 ${listing.location || 'N/A'}</p>
                        <p class="bento-description">${description}</p>
                        <div class="bento-price">${priceFormatted}</div>
                    </div>
                </a>
            </div>
        `;
    };

    /**
     * Fetches listings and renders a selection of them as featured.
     */
    const fetchAndRenderFeatured = async () => {
        try {
            const data = await fetchListings();

            if (data.records && data.records.length > 0) {
                // For now, we'll feature the first 6 properties.
                // This could be enhanced to look for a "Featured" flag from the API.
                const featuredProperties = (data.records || data).slice(0, 6);
                featuredContainer.innerHTML = featuredProperties.map(createListingCard).join('');

                // Initialize favorites and lazy loading for the new cards
                if (window.FavoritesManager) {
                    FavoritesManager.initFavoriteButtons();
                }
                if (window.initLazyLoader) {
                    window.initLazyLoader();
                }
            } else {
                featuredContainer.innerHTML = '<p>No featured properties available at the moment.</p>';
            }
        } catch (error) {
            console.error('Failed to fetch featured listings:', error);
            console.log('Using placeholder data for featured listings.');
            // Fallback to placeholder data if the fetch fails
            if (typeof placeholderProperties !== 'undefined' && placeholderProperties.length > 0) {
                // Map placeholder data to the new structure before rendering
                const featuredProperties = placeholderProperties.slice(0, 6).map(p => ({
                    ...p.fields, listingId: p.id, image: p.fields.Image?.[0]?.url
                }));
                featuredContainer.innerHTML = featuredProperties.map(createListingCard).join('');
                // Initialize features for placeholder cards
                if (window.FavoritesManager) FavoritesManager.initFavoriteButtons();
                if (window.initLazyLoader) window.initLazyLoader();
            } else {
                featuredContainer.innerHTML = '<p>Sorry, we were unable to load featured properties. Please try again later.</p>';
            }
        }
    };

    fetchAndRenderFeatured();
});