/**
 * areas-ui.js
 * Overrides / extends the area page behaviour from airtable.js to implement
 * a clean two-view UX:
 *   VIEW 1 – Area gallery (card grid) — shown when no area is selected.
 *   VIEW 2 – Area listings  (sticky header with dropdown switcher + back btn)
 *            — shown when an area is selected.
 *
 * This file MUST be loaded AFTER airtable.js.
 */

(function () {
  'use strict';

  /* ── icons cycling through area cards ── */
  var AREA_ICONS = ['🏙️','🏘️','🌇','🏢','🌆','🏗️','🏠','🌃','🏬','🏛️'];
  function getAreaIcon(i) { return AREA_ICONS[i % AREA_ICONS.length]; }

  /* ── view switching ── */
  function showGalleryView() {
    var gv = document.getElementById('area-gallery-view');
    var lv = document.getElementById('area-listings-view');
    if (gv) gv.classList.remove('area-filter-hidden');
    if (lv) lv.classList.add('area-filter-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showListingsView() {
    var gv = document.getElementById('area-gallery-view');
    var lv = document.getElementById('area-listings-view');
    if (gv) gv.classList.add('area-filter-hidden');
    if (lv) lv.classList.remove('area-filter-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── helpers ── */
  function esc(str) {
    // re-use the helper from airtable.js if available, otherwise do it inline
    if (typeof escapeHtml === 'function') return escapeHtml(str);
    return (str || '').toString()
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function getDesc(location) {
    if (typeof getAreaCardDescription === 'function') return getAreaCardDescription(location);
    return 'Explore properties, trends, and neighbourhood insights in ' + location + '.';
  }

  function toSlug(v) {
    if (typeof toAreaSlug === 'function') return toAreaSlug(v);
    return (v||'').toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-');
  }

  function esc_html(str) { return esc(str); }

  /* ── wire the sticky header controls ── */
  function wireControls(availableLocations) {
    // Back button
    var backBtn = document.getElementById('area-back-btn');
    if (backBtn) {
      var nb = backBtn.cloneNode(true);
      backBtn.parentNode.replaceChild(nb, backBtn);
      nb.addEventListener('click', function () {
        // clear the fixed location in airtable.js scope
        if (typeof window._areasUiClearLocation === 'function') {
          window._areasUiClearLocation();
        }
        showGalleryView();
      });
    }

    // Dropdown switcher
    var oldSel = document.getElementById('area-switcher');
    if (oldSel) {
      var newSel = document.createElement('select');
      newSel.id = 'area-switcher';
      newSel.className = oldSel.className;
      newSel.setAttribute('aria-label', 'Switch area');
      oldSel.parentNode.replaceChild(newSel, oldSel);

      availableLocations.forEach(function (loc) {
        var opt = document.createElement('option');
        opt.value = loc;
        opt.textContent = loc;
        if (typeof fixedAreaLocation !== 'undefined' && loc === fixedAreaLocation) opt.selected = true;
        newSel.appendChild(opt);
      });

      newSel.addEventListener('change', function () {
        if (typeof window._areasUiSelectLocation === 'function') {
          window._areasUiSelectLocation(newSel.value);
        }
      });
    }
  }

  /* ── main override – called after airtable.js sets up allListings ── */
  function patchAreaPageContext() {
    if (typeof applyAreaPageContext !== 'function') return;

    /* Expose internal callbacks so wireControls can reach the airtable.js scope */
    window._areasUiClearLocation = function () {
      fixedAreaLocation = '';
      var url = new URL(window.location.href);
      url.searchParams.delete('area');
      url.searchParams.delete('location');
      window.history.replaceState({}, '', url.toString());
      var locationFilter = document.getElementById('filter-location');
      if (locationFilter) locationFilter.value = '';
      // Re-render gallery (no area)
      applyAreaPageContext(allListings);
    };

    window._areasUiSelectLocation = function (loc) {
      fixedAreaLocation = loc;
      if (typeof updateAreaUrl === 'function') updateAreaUrl(loc);
      var locationFilter = document.getElementById('filter-location');
      if (locationFilter) locationFilter.value = loc;
      applyAreaPageContext(allListings);
      if (typeof applyFiltersAndRender === 'function') applyFiltersAndRender();
      showListingsView();
    };

    /* Save references to original functions */
    var _origApplyAreaPageContext = applyAreaPageContext;
    var _origInitListingsPage = (typeof initListingsPage !== 'undefined') ? initListingsPage : null;

    /* Also override initListingsPage to prevent duplicate fetch on areas page */
    var _origInitListingsPage = (typeof initListingsPage !== 'undefined') ? initListingsPage : null;
    if (typeof initListingsPage !== 'undefined') {
      initListingsPage = function () {
        if (document.body.dataset.page === 'areas') {
          console.log('[areas-ui.js] Blocked default initListingsPage to prevent duplicate rendering');
          return;
        }
        if (typeof _origInitListingsPage === 'function') {
          return _origInitListingsPage();
        }
      };
    }

    /* Override applyAreaPageContext */
    applyAreaPageContext = function (records) {
      if (document.body.dataset.page !== 'areas') {
        return _origApplyAreaPageContext(records);
      }

      /* ── Compute available locations (same as original) ── */
      var availableLocations = Array.from(new Set(
        records
          .map(function (r) { return (r.fields && r.fields['Location'] || '').trim(); })
          .filter(Boolean)
      )).sort(function (a, b) { return a.localeCompare(b); });

      /* ── Normalise fixedAreaLocation against real data ── */
      if (typeof fixedAreaLocation !== 'undefined' && fixedAreaLocation) {
        var matched = availableLocations.find(function (l) {
          return l.toLowerCase() === fixedAreaLocation.toLowerCase();
        });
        fixedAreaLocation = matched || '';
      }

      /* ── Keep hidden filter-location synced ── */
      var locationFilter = document.getElementById('filter-location');
      if (locationFilter) {
        locationFilter.value = (typeof fixedAreaLocation !== 'undefined') ? fixedAreaLocation : '';
        locationFilter.disabled = true;
      }

      /* ── Rebuild gallery cards ── */
      var grid = document.getElementById('area-location-grid');
      if (grid) {
        grid.innerHTML = '';
        availableLocations.forEach(function (location, idx) {
          var card = document.createElement('div');
          card.className = 'area-location-card';
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-label', 'View properties in ' + location);
          card.dataset.area = location;
          var desc = getDesc(location);
          card.innerHTML =
            '<div class="area-card-icon">' + getAreaIcon(idx) + '</div>' +
            '<h3>' + esc_html(location) + '</h3>' +
            '<p>' + esc_html(desc) + '</p>' +
            '<span class="area-card-cta">View listings ' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
            '</span>';

          var onSelect = function () {
            if (typeof window._areasUiSelectLocation === 'function') {
              window._areasUiSelectLocation(location);
            }
          };
          card.addEventListener('click', onSelect);
          card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
          });
          grid.appendChild(card);
        });
      }

      /* ── Wire sticky header controls ── */
      wireControls(availableLocations);

      /* ── Update listings heading ── */
      var listingsHeading = document.getElementById('area-listings-heading');
      if (listingsHeading) {
        var curLoc = (typeof fixedAreaLocation !== 'undefined') ? fixedAreaLocation : '';
        listingsHeading.textContent = curLoc
          ? 'Properties in ' + curLoc
          : 'Properties';
      }

      /* ── Update count badge ── */
      var badge = document.getElementById('area-listing-count-badge');
      if (badge) {
        var curLoc = (typeof fixedAreaLocation !== 'undefined') ? fixedAreaLocation : '';
        if (curLoc) {
          var cnt = records.filter(function (r) {
            return (r.fields && r.fields['Location'] || '').trim().toLowerCase() === curLoc.toLowerCase();
          }).length;
          badge.textContent = cnt + ' listing' + (cnt === 1 ? '' : 's');
        } else {
          badge.textContent = '';
        }
      }

      /* ── Area description bar ── */
      var descriptionEl = document.getElementById('area-description');
      var descBar = document.getElementById('area-description-bar');
      if (descriptionEl && descBar) {
        var curLoc = (typeof fixedAreaLocation !== 'undefined') ? fixedAreaLocation : '';
        if (curLoc) {
          descriptionEl.textContent = 'Loading area details...';
          descBar.classList.remove('area-filter-hidden');
        } else {
          descriptionEl.textContent = '';
          descBar.classList.add('area-filter-hidden');
        }
      }

      /* ── Hydrate Q&A ── */
      var curLoc = (typeof fixedAreaLocation !== 'undefined') ? fixedAreaLocation : '';
      if (curLoc && typeof hydrateAreaInsights === 'function') {
        hydrateAreaInsights(curLoc);
      }

      /* ── Switch between views ── */
      if (curLoc) {
        showListingsView();
      } else {
        showGalleryView();
      }
    };
  }

  /* ── Bootstrap: patch immediately ── */
  patchAreaPageContext();
})();
