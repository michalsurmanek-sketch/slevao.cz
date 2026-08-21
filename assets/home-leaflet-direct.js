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
  const DAY_MS = 86400000;

  function pragueDate(offsetDays = 0) {
    const target = new Date(Date.now() + offsetDays * DAY_MS);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(target);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  const today = pragueDate(0);
  const upcomingTo = pragueDate(7);
  const resolved = new Map();
  const queued = new Set();
  let batchPromise = null;

  function leafletUrl(documentUrl) {
    const raw = String(documentUrl || '').trim();
    if (!/^https:\/\//i.test(raw)) return '';
    return `${raw.split('#')[0]}#page=1&zoom=page-fit`;
  }

  function chooseLeaflet(rows, storeSlug) {
    const candidates = rows.filter((row) => String(row?.store_slug || '') === storeSlug);
    const current = candidates
      .filter((row) => String(row?.valid_from || '') <= today && String(row?.valid_to || '') >= today)
      .sort((a, b) => String(a.valid_to || '').localeCompare(String(b.valid_to || '')))[0];
    if (current) return current;

    return candidates
      .filter((row) => String(row?.valid_from || '') > today && String(row?.valid_from || '') <= upcomingTo)
      .sort((a, b) => String(a.valid_from || '').localeCompare(String(b.valid_from || '')))[0] || null;
  }

  async function fetchBatch(storeSlugs) {
    const safe = [...new Set(storeSlugs)]
      .map((slug) => String(slug || '').trim().toLowerCase())
      .filter((slug) => /^[a-z0-9-]+$/.test(slug));
    if (!safe.length) return;

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
      safe.forEach((slug) => {
        const row = chooseLeaflet(rows, slug);
        resolved.set(slug, leafletUrl(row?.document_url));
      });
    } catch (error) {
      console.warn('Přímé letáky nejsou dostupné:', error);
      safe.forEach((slug) => resolved.set(slug, ''));
    }
  }

  function queueBatch(storeSlugs) {
    storeSlugs.forEach((slug) => {
      if (slug && !resolved.has(slug)) queued.add(slug);
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

  function enhanceCard(card, storeSlug) {
    const link = card.querySelector('.leafletAction a');
    const url = resolved.get(storeSlug) || '';
    if (!link || !url || !card.isConnected) return;

    link.href = url;
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
      if (resolved.has(storeSlug)) enhanceCard(card, storeSlug);
      else missing.push(storeSlug);
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

  attach();
})();