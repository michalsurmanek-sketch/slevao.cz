(() => {
  'use strict';

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
  const pending = new Map();

  function leafletUrl(documentUrl) {
    const raw = String(documentUrl || '').trim();
    if (!/^https:\/\//i.test(raw)) return '';
    return `${raw.split('#')[0]}#page=1&zoom=page-fit`;
  }

  async function queryLeaflet(storeSlug, upcoming = false) {
    const params = new URLSearchParams({
      select: 'document_url,valid_from,valid_to',
      store_slug: `eq.${storeSlug}`,
      valid_to: `gte.${today}`,
      valid_from: upcoming ? `gt.${today}` : `lte.${today}`,
      order: upcoming ? 'valid_from.asc' : 'valid_to.asc',
      limit: '1'
    });

    if (upcoming) params.set('valid_from', `lte.${upcomingTo}`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/public_product_leaflet_locations?${params}`, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Leták se nepodařilo načíst (${response.status}).`);
    const row = (await response.json())[0];
    return leafletUrl(row?.document_url);
  }

  async function resolveLeaflet(storeSlug) {
    if (!storeSlug) return '';
    if (resolved.has(storeSlug)) return resolved.get(storeSlug);
    if (pending.has(storeSlug)) return pending.get(storeSlug);

    const request = (async () => {
      try {
        let url = await queryLeaflet(storeSlug, false);
        if (!url) {
          const params = new URLSearchParams({
            select: 'document_url,valid_from,valid_to',
            store_slug: `eq.${storeSlug}`,
            valid_to: `gte.${today}`,
            valid_from: `gt.${today}`,
            order: 'valid_from.asc',
            limit: '20'
          });
          const response = await fetch(`${SUPABASE_URL}/rest/v1/public_product_leaflet_locations?${params}`, {
            headers: { apikey: SUPABASE_KEY },
            cache: 'no-store'
          });
          if (response.ok) {
            const rows = await response.json();
            const row = rows.find((item) => String(item.valid_from || '') <= upcomingTo);
            url = leafletUrl(row?.document_url);
          }
        }
        resolved.set(storeSlug, url || '');
        return url || '';
      } catch (error) {
        console.warn(`Přímý leták pro ${storeSlug} není dostupný:`, error);
        resolved.set(storeSlug, '');
        return '';
      } finally {
        pending.delete(storeSlug);
      }
    })();

    pending.set(storeSlug, request);
    return request;
  }

  async function enhanceCard(card) {
    const storeControl = card.querySelector('.leafletAction [data-store]');
    const storeSlug = storeControl?.dataset.store || '';
    const link = card.querySelector('.leafletAction a');
    if (!storeSlug || !link) return;

    const url = await resolveLeaflet(storeSlug);
    if (!url || !card.isConnected) return;

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
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    grid.querySelectorAll('.leafletCard').forEach((card) => enhanceCard(card));
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(scan);
  }

  function attach() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) {
      window.setTimeout(attach, 120);
      return;
    }
    new MutationObserver(schedule).observe(grid, { childList: true, subtree: true });
    schedule();
  }

  attach();
})();
