(() => {
  'use strict';

  const grid = document.getElementById('leafletGrid');
  if (grid && grid.dataset.leafletGridGuard !== '1') {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (descriptor?.get && descriptor?.set) {
      window.__slevaoDedicatedLeafletGrid = true;
      grid.dataset.leafletGridGuard = '1';
      Object.defineProperty(grid, 'innerHTML', {
        configurable: true,
        enumerable: false,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          const html = String(value ?? '');
          const dedicatedWrite =
            html.includes('data-direct-leaflet-card="1"') ||
            html.includes('data-fast-skeleton=') ||
            html.includes('leafletFastSkeleton');
          if (window.__slevaoDedicatedLeafletGrid && !dedicatedWrite) return;
          descriptor.set.call(this, value);
        },
      });

      if (!grid.querySelector('.leafletCard[data-direct-leaflet-card="1"]')) {
        descriptor.set.call(grid, [0, 1, 2].map((index) => `<article class="leafletCard leafletFastSkeleton" data-fast-skeleton="${index}"><div class="leafletCover"></div><div class="leafletBody"><div class="leafletSkeletonLine wide"></div><div class="leafletSkeletonLine"></div><div class="leafletSkeletonLine short"></div></div></article>`).join(''));
      }
    }
  }

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const DIRECT_CACHE_TTL = 30 * 60 * 1000;
  const REFRESH_CHECK_MS = 5 * 60 * 1000;

  function pragueDate(offsetDays = 0, now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const calendarDay = new Date(Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day), 12
    ));
    calendarDay.setUTCDate(calendarDay.getUTCDate() + offsetDays);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(calendarDay);
  }

  const resolved = new Map();
  const queued = new Set();
  let batchPromise = null;

  function leafletUrl(documentUrl) {
    const raw = String(documentUrl || '').trim();
    if (!/^https:\/\//i.test(raw)) return '';
    return `${raw.split('#')[0]}#page=1&zoom=page-fit`;
  }

  function chooseLeaflet(rows, storeSlug, today, upcomingTo) {
    const candidates = rows.filter((row) => String(row?.store_slug || '') === storeSlug);
    const current = candidates
      .filter((row) => String(row?.valid_from || '') <= today && String(row?.valid_to || '') >= today)
      .sort((a, b) => String(a.valid_to || '').localeCompare(String(b.valid_to || '')))[0];
    if (current) return current;

    return candidates
      .filter((row) => String(row?.valid_from || '') > today && String(row?.valid_from || '') <= upcomingTo)
      .sort((a, b) => String(a.valid_from || '').localeCompare(String(b.valid_from || '')))[0] || null;
  }

  function freshResolved(storeSlug) {
    const entry = resolved.get(storeSlug);
    if (!entry) return null;
    const today = pragueDate(0);
    if (entry.day !== today || Date.now() - entry.fetchedAt >= DIRECT_CACHE_TTL) {
      resolved.delete(storeSlug);
      return null;
    }
    return entry;
  }

  async function fetchBatch(storeSlugs) {
    const safe = [...new Set(storeSlugs)]
      .map((slug) => String(slug || '').trim().toLowerCase())
      .filter((slug) => /^[a-z0-9-]+$/.test(slug));
    if (!safe.length) return;

    const today = pragueDate(0);
    const upcomingTo = pragueDate(7);
    const params = new URLSearchParams({
      select: 'store_slug,document_url,valid_from,valid_to',
      store_slug: `in.(${safe.join(',')})`,
      valid_to: `gte.${today}`,
      valid_from: `lte.${upcomingTo}`,
      order: 'store_slug.asc,valid_from.asc,valid_to.asc',
      limit: String(Math.min(500, Math.max(60, safe.length * 20)))
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/public_product_leaflet_locations?${params}`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'default'
      });
      if (!response.ok) throw new Error(`Letáky se nepodařilo načíst (${response.status}).`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : [];
      const fetchedAt = Date.now();
      safe.forEach((slug) => {
        const row = chooseLeaflet(rows, slug, today, upcomingTo);
        resolved.set(slug, { url: leafletUrl(row?.document_url), fetchedAt, day: today });
      });
    } catch (error) {
      console.warn('Přímé letáky nejsou dostupné:', error);
      const fetchedAt = Date.now();
      safe.forEach((slug) => resolved.set(slug, { url: '', fetchedAt, day: today }));
    }
  }

  function queueBatch(storeSlugs) {
    storeSlugs.forEach((slug) => {
      if (slug && !freshResolved(slug)) queued.add(slug);
    });
    if (batchPromise) return batchPromise;

    batchPromise = (async () => {
      while (queued.size) {
        const batch = [...queued];
        queued.clear();
        await fetchBatch(batch);
      }
    })().finally(() => {
      batchPromise = null;
      schedule();
    });

    return batchPromise;
  }

  function rememberFallbackLink(link, storeSlug) {
    if (!link.dataset.directLeafletFallback) {
      link.dataset.directLeafletFallback = link.getAttribute('href') || `${encodeURIComponent(storeSlug)}.html`;
    }
  }

  function resetCardLink(card, storeSlug) {
    const link = card.querySelector('.leafletAction a');
    if (!link || !card.isConnected) return;
    rememberFallbackLink(link, storeSlug);
    if (link.dataset.directLeaflet !== '1') return;
    link.href = link.dataset.directLeafletFallback;
    link.removeAttribute('target');
    link.removeAttribute('rel');
    delete link.dataset.directLeaflet;
    link.setAttribute('aria-label', `Otevřít nabídky obchodu ${storeSlug}`);
    link.removeAttribute('title');
  }

  function enhanceCard(card, storeSlug, entry) {
    const link = card.querySelector('.leafletAction a');
    if (!link || !entry?.url || !card.isConnected) {
      resetCardLink(card, storeSlug);
      return;
    }

    rememberFallbackLink(link, storeSlug);
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.dataset.directLeaflet = '1';
    link.setAttribute('aria-label', `Prolistovat aktuální leták obchodu ${storeSlug}`);
    link.title = 'Otevřít aktuální leták od první strany';
  }

  let frame = 0;
  function scan() {
    frame = 0;
    const currentGrid = document.getElementById('leafletGrid');
    if (!currentGrid) return;

    const missing = [];
    currentGrid.querySelectorAll('.leafletCard[data-direct-leaflet-card="1"]').forEach((card) => {
      const storeSlug = card.querySelector('.leafletAction [data-store]')?.dataset.store || '';
      if (!storeSlug) return;
      const entry = freshResolved(storeSlug);
      if (entry) enhanceCard(card, storeSlug, entry);
      else {
        resetCardLink(card, storeSlug);
        missing.push(storeSlug);
      }
    });

    if (missing.length) queueBatch(missing);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(scan);
  }

  function attach() {
    const currentGrid = document.getElementById('leafletGrid');
    if (!currentGrid) {
      window.setTimeout(attach, 120);
      return;
    }
    new MutationObserver(schedule).observe(currentGrid, { childList: true, subtree:true });
    schedule();
  }

  window.setInterval(() => {
    if (!document.hidden) schedule();
  }, REFRESH_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule();
  });

  attach();
})();