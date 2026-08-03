(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const $ = (id) => document.getElementById(id);
  const escSelectorValue = (value) => String(value || '').replace(/[^a-z0-9-]/gi, '');

  function requestedSlug() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('store') || params.get('slug');
    if (fromQuery) return escSelectorValue(fromQuery.toLowerCase());
    const match = location.pathname.match(/\/([^/]+)\.html$/i);
    return escSelectorValue(match?.[1]?.toLowerCase() || '');
  }

  function showError(title, text) {
    document.title = `${title} | Slevao.cz`;
    const status = $('status');
    const grid = $('grid');
    const result = $('resultCount');
    if (status) status.textContent = title;
    if (result) result.textContent = '0 nabídek';
    if (grid) grid.innerHTML = `<div class="loading"><strong>${title}</strong><br>${text}<br><br><a class="back" href="./">← Zpět na všechny obchody</a></div>`;
  }

  async function fetchStore(slug) {
    const query = new URLSearchParams({
      select: 'id,name,slug,logo_url,primary_color,website_url,is_active',
      slug: `eq.${slug}`,
      limit: '1',
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Databáze vrátila chybu ${response.status}.`);
      const rows = await response.json();
      return rows[0] || null;
    } finally {
      clearTimeout(timer);
    }
  }

  function updatePage(store) {
    const title = `${store.name} leták a akční nabídky dnes | Slevao.cz`;
    const description = `Aktuální leták, slevy a akční ceny obchodu ${store.name}. Nabídky se automaticky aktualizují.`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', `${store.name} – aktuální leták a slevy`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    const canonical = `${location.origin}/${encodeURIComponent(store.slug)}.html`;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical);

    const titleName = $('titleName');
    const logo = $('storeLogo');
    const search = $('q');
    const leafletEyebrow = $('leafletEyebrow');
    const leafletHeading = $('leafletHeading');
    const officialLink = $('officialStoreLink');
    if (titleName) titleName.textContent = store.name;
    if (logo) {
      logo.alt = store.name;
      logo.src = store.logo_url || '';
      logo.hidden = !store.logo_url;
    }
    if (search) search.placeholder = `Hledat v akcích ${store.name}…`;
    if (leafletEyebrow) leafletEyebrow.textContent = `LETÁKY A NABÍDKY ${store.name.toUpperCase()}`;
    if (leafletHeading) leafletHeading.textContent = `Aktuální letáky ${store.name}`;
    if (officialLink) {
      if (store.website_url) {
        officialLink.href = store.website_url;
        officialLink.textContent = `Oficiální web ${store.name} ↗`;
        officialLink.hidden = false;
      } else {
        officialLink.hidden = true;
      }
    }
  }

  function loadFeed() {
    const script = document.createElement('script');
    script.src = 'assets/store-feed.js?v=20260803-1';
    script.defer = true;
    script.onerror = () => showError('Načtení selhalo', 'Skript s nabídkami se nepodařilo načíst. Obnov stránku přes Ctrl+F5.');
    document.body.append(script);
  }

  async function init() {
    const slug = requestedSlug();
    if (!slug || ['obchod', 'index', 'admin', 'login'].includes(slug)) {
      showError('Obchod nebyl vybrán', 'Otevři stránku obchodu ze seznamu na hlavní stránce.');
      return;
    }

    try {
      const store = await fetchStore(slug);
      if (!store) {
        showError('Obchod nebyl nalezen', 'Tento obchod zatím v databázi Slevao.cz není.');
        return;
      }
      if (!store.is_active) {
        showError('Obchod je dočasně skrytý', 'Nabídky tohoto obchodu momentálně nejsou veřejně dostupné.');
        return;
      }

      window.SLEVAO_STORE = {
        slug: store.slug,
        name: store.name,
        logo: store.logo_url || '',
        color: store.primary_color || '#069D92',
      };
      updatePage(store);
      loadFeed();
    } catch (error) {
      console.error(error);
      showError('Obchod se nepodařilo načíst', error?.name === 'AbortError'
        ? 'Databáze neodpověděla včas. Zkus stránku znovu načíst.'
        : 'Zkontroluj připojení a obnov stránku.');
    }
  }

  init();
})();
