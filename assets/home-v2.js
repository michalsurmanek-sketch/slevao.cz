(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const SAVED_KEY = 'slevao-saved';
  const RECENT_KEY = 'slevao-recent-searches';
  const PAGE_SIZE = window.matchMedia('(min-width: 801px)').matches ? 26 : 24;
  const UPCOMING_DAYS = 7;
  const pragueDateKey = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
  const REGIONS = [
    ['CZ010','Hlavní město Praha'],['CZ020','Středočeský kraj'],['CZ031','Jihočeský kraj'],['CZ032','Plzeňský kraj'],
    ['CZ041','Karlovarský kraj'],['CZ042','Ústecký kraj'],['CZ051','Liberecký kraj'],['CZ052','Královéhradecký kraj'],
    ['CZ053','Pardubický kraj'],['CZ063','Kraj Vysočina'],['CZ064','Jihomoravský kraj'],['CZ071','Olomoucký kraj'],
    ['CZ072','Zlínský kraj'],['CZ080','Moravskoslezský kraj']
  ];
  const CATEGORY_DEFS = [
    ['food','Potraviny','🥫'],['drinks','Nápoje','🥤'],['drugstore','Drogerie','🧴'],['home','Domácnost','🏠'],
    ['electronics','Elektronika','🔌'],['garden','Zahrada','🌿'],['fashion','Oblečení','👕'],['pharmacy','Lékárna','💊'],
    ['school','Škola','🎒'],['sports','Sport','⚽'],['toys','Hračky','🧸'],['pets','Zvířata','🐾'],['auto','Auto','🚗'],['other','Ostatní','🏷️']
  ];
  const LOCAL_LOGOS = { penny:'assets/logos/penny.svg?v=4', 'eso-market':'assets/logos/eso-market.svg?v=1' };
  const STORE_DOMAINS = {
    albert:'albert.cz',billa:'billa.cz',coop:'coop.cz',globus:'globus.cz',hruska:'mojehruska.cz',kaufland:'kaufland.cz',lidl:'lidl.cz',makro:'makro.cz',penny:'penny.cz',tesco:'itesco.cz',
    dm:'dm.cz',rossmann:'rossmann.cz',teta:'tetadrogerie.cz',action:'action.com',pepco:'pepco.cz',kik:'kik.cz',jysk:'jysk.cz',ikea:'ikea.com',obi:'obi.cz',hornbach:'hornbach.cz',bauhaus:'bauhaus.cz',
    mountfield:'mountfield.cz',planeo:'planeo.cz',datart:'datart.cz',alza:'alza.cz','dr-max':'drmax.cz',benu:'benu.cz',pilulka:'pilulka.cz',rohlik:'rohlik.cz',kosik:'kosik.cz'
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits:2 });
  const date = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' }).format(new Date(`${value}T12:00:00`)) : '–';
  const priceOf = (offer) => Number(offer?.price || 0);
  const oldPriceOf = (offer) => Number(offer?.old_price || 0);
  const savingOf = (offer) => Math.max(0, oldPriceOf(offer) - priceOf(offer));
  const discountOf = (offer) => oldPriceOf(offer) > priceOf(offer) ? Math.round(savingOf(offer) / oldPriceOf(offer) * 100) : 0;
  const isUpcoming = (offer, today = pragueDateKey()) => String(offer?.valid_from || '') > today;
  const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } };
  const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const initialQuery = new URLSearchParams(location.search).get('q')?.trim() || '';

  const state = {
    offers: [], total: 0, facets: null, globalFacets: null, allStores: [], locationRows: [],
    query: initialQuery, store:'all', category:'all', region:'all', city:'all', minPrice:null, maxPrice:null,
    onlyImages:false, mode:initialQuery ? 'all' : 'recommended', sort:'recommended', savedOnly:false,
    saved:new Set(readJSON(SAVED_KEY, []).map(String)), storesExpanded:false, reportOffer:null,
    requestVersion:0, suggestionsVersion:0, locationVersion:0, loading:false
  };

  function toast(message) {
    const box = $('toast');
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { box.hidden = true; }, 2800);
  }

  async function rpc(name, payload = {}, timeoutMs = 18000) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
          method:'POST',
          headers:{ apikey:SUPABASE_KEY, 'content-type':'application/json', accept:'application/json' },
          body:JSON.stringify(payload),
          cache:'no-store',
          signal:controller.signal
        });
        if (response.ok) return await response.json();
        let body = null;
        try { body = await response.json(); } catch {}
        const error = new Error(body?.message || `Databáze vrátila chybu ${response.status}.`);
        const transient = [502,503,504].includes(response.status) || body?.code === 'PGRST002';
        if (!transient || attempt === 1) throw error;
        lastError = error;
      } catch (error) {
        lastError = error;
        if (attempt === 1 || (error?.name !== 'AbortError' && !/schema cache|PGRST002/i.test(String(error?.message || '')))) throw error;
      } finally {
        window.clearTimeout(timer);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw lastError || new Error('Databázi se nepodařilo načíst.');
  }

  function categoryLabel(key) {
    return CATEGORY_DEFS.find((item) => item[0] === key)?.[1] || key || 'Ostatní';
  }

  function normalizeOffer(raw) {
    const offer = raw && typeof raw === 'object' ? { ...raw } : {};
    const canonical = fold(offer.products?.filter_group || 'other');
    offer._category = CATEGORY_DEFS.some(([key]) => key === canonical) ? canonical : 'other';
    const sourceImage = offer.image_url || offer.products?.image_url || null;
    const knownMisassignedBeerImage = String(sourceImage || '').includes('8594009923191_CZ_P')
      && !fold(offer.products?.name || offer.title).includes('krusovice');
    offer.image_url = knownMisassignedBeerImage
      ? (offer.products?.image_url && !String(offer.products.image_url).includes('8594009923191_CZ_P') ? offer.products.image_url : null)
      : sourceImage;
    return offer;
  }

  function pagePayload(offset = 0, limit = PAGE_SIZE, queryOverride = null) {
    return {
      p_limit:limit,
      p_offset:offset,
      p_include_upcoming:true,
      p_store_slug:state.store === 'all' ? null : state.store,
      p_min_price:state.minPrice,
      p_max_price:state.maxPrice,
      p_only_images:state.onlyImages,
      p_sort:state.sort,
      p_query:queryOverride === null ? (state.query || null) : (queryOverride || null),
      p_filter_group:state.category === 'all' ? null : state.category,
      p_region_code:state.region === 'all' ? null : state.region,
      p_city_name:state.city === 'all' ? null : state.city,
      p_mode:queryOverride === null ? state.mode : 'all'
    };
  }

  function savedPayload(offset = 0) {
    return {
      p_offer_ids:[...state.saved], p_limit:PAGE_SIZE, p_offset:offset,
      p_store_slug:state.store === 'all' ? null : state.store,
      p_min_price:state.minPrice, p_max_price:state.maxPrice, p_only_images:state.onlyImages,
      p_query:state.query || null, p_filter_group:state.category === 'all' ? null : state.category,
      p_region_code:state.region === 'all' ? null : state.region,
      p_city_name:state.city === 'all' ? null : state.city, p_sort:state.sort
    };
  }

  function facetPayload() {
    return {
      p_include_upcoming:true,
      p_store_slug:state.store === 'all' ? null : state.store,
      p_min_price:state.minPrice,
      p_max_price:state.maxPrice,
      p_only_images:state.onlyImages,
      p_query:state.query || null,
      p_filter_group:state.category === 'all' ? null : state.category,
      p_region_code:state.region === 'all' ? null : state.region,
      p_city_name:state.city === 'all' ? null : state.city,
      p_mode:'all'
    };
  }

  async function fetchPage(offset = 0) {
    if (state.savedOnly) {
      if (!state.saved.size) return { offers:[], total:0 };
      const rows = await rpc('get_public_saved_offer_page', savedPayload(offset));
      return { offers:(Array.isArray(rows) ? rows : []).map((row) => normalizeOffer(row.offer)), total:Number(rows?.[0]?.total_count || 0) };
    }
    const rows = await rpc('get_public_offer_page_filtered', pagePayload(offset));
    return { offers:(Array.isArray(rows) ? rows : []).map((row) => normalizeOffer(row.offer)), total:Number(rows?.[0]?.total_count || 0) };
  }

  async function fetchFacets() {
    const data = await rpc('get_public_offer_facets', facetPayload());
    return data && typeof data === 'object' && !Array.isArray(data) ? data : { total:0,current_count:0,upcoming_count:0,stores:[],groups:[] };
  }

  async function loadGlobalFacets() {
    const data = await rpc('get_public_offer_facets', {
      p_include_upcoming:true,p_store_slug:null,p_min_price:null,p_max_price:null,p_only_images:false,
      p_query:null,p_filter_group:null,p_region_code:null,p_city_name:null,p_mode:'all'
    });
    state.globalFacets = data || {};
    state.allStores = Array.isArray(data?.stores) ? [...data.stores].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'cs')) : [];
    if ($('offerCount')) $('offerCount').textContent = Number(data?.current_count || 0).toLocaleString('cs-CZ');
    if ($('storeCount')) $('storeCount').textContent = state.allStores.length.toLocaleString('cs-CZ');
    return state.globalFacets;
  }

  async function loadLocationRows() {
    const version = ++state.locationVersion;
    const region = state.region;
    state.locationRows = [];
    if (region === 'all') return true;
    try {
      const rows = await rpc('get_public_offer_location_facets', { p_region_code:region });
      if (version !== state.locationVersion || state.region !== region) return false;
      state.locationRows = Array.isArray(rows) ? rows : [];
      return true;
    } catch (error) {
      if (version !== state.locationVersion || state.region !== region) return false;
      console.warn('Města pro vybraný kraj se nepodařilo načíst:', error);
      state.locationRows = [];
      return true;
    }
  }

  function storeLogoCandidates(store) {
    const list = [];
    if (LOCAL_LOGOS[store?.slug]) list.push(new URL(LOCAL_LOGOS[store.slug], document.baseURI).href);
    if (store?.logo_url) list.push(store.logo_url);
    const domain = STORE_DOMAINS[store?.slug];
    if (domain) list.push(`https://logo.clearbit.com/${domain}?size=256`, `https://www.google.com/s2/favicons?sz=256&domain_url=https://${domain}`);
    return [...new Set(list.filter(Boolean))];
  }

  function logoHTML(store, className = '') {
    const list = storeLogoCandidates(store || {});
    if (!list.length) return '<span class="storeAllIcon">🏪</span>';
    return `<img class="${className}" src="${esc(list[0])}" data-logo-list="${esc(JSON.stringify(list))}" data-logo-index="0" alt="Logo ${esc(store?.name || '')}" loading="lazy" onerror="window.slevaoLogoError(this)">`;
  }

  window.slevaoLogoError = (img) => {
    let list = [];
    try { list = JSON.parse(img.dataset.logoList || '[]'); } catch {}
    const next = Number(img.dataset.logoIndex || 0) + 1;
    if (next < list.length) { img.dataset.logoIndex = String(next); img.src = list[next]; return; }
    img.replaceWith(Object.assign(document.createElement('span'), { className:'storeAllIcon', textContent:'🏪' }));
  };

  function quantityInfo(offer) {
    const source = `${offer.products?.quantity_text || ''} ${offer.title || ''}`;
    const match = source.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ks)\b/i);
    if (!match) return null;
    const amount = Number(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase();
    if (!amount) return null;
    if (unit === 'kg') return { label:`${amount} kg`, base:amount, baseLabel:'kg' };
    if (unit === 'g') return { label:`${amount} g`, base:amount / 1000, baseLabel:'kg' };
    if (unit === 'l') return { label:`${amount} l`, base:amount, baseLabel:'l' };
    if (unit === 'ml') return { label:`${amount} ml`, base:amount / 1000, baseLabel:'l' };
    return { label:`${amount} ks`, base:amount, baseLabel:'ks' };
  }

  function unitPrice(offer) {
    const info = quantityInfo(offer);
    if (!info?.base) return '';
    return `${money(priceOf(offer) / info.base)} Kč/${info.baseLabel}`;
  }

  function leafletLocation(offer) {
    const page = Number(offer?.metadata?.leaflet_page || 0);
    const documentUrl = String(offer?.metadata?.leaflet_document_url || '');
    if (!Number.isInteger(page) || page < 1 || page > 500 || !/^https:\/\/.*\.pdf(?:\?|$)/i.test(documentUrl)) return null;
    return { page, url:`${documentUrl}#page=${page}&zoom=page-fit` };
  }

  function bulkPurchaseLabel(description) {
    const match = String(description || '').match(/při\s+koupi\s+(\d+)\s+kus(?:ů|u)?/i);
    return match ? `při koupi ${match[1]} ks` : '';
  }

  function compactQuantity(value) {
    return String(value || '').split(/\s*\/\s*/)[0].trim().replace(/\s*=\s*/g, ' · ').replace(/pracích\s+dávek/gi, 'dávek').replace(/\s+/g, ' ').trim();
  }

  function saveRecent(value) {
    const term = String(value || '').trim();
    if (!term) return;
    const current = readJSON(RECENT_KEY, []);
    writeJSON(RECENT_KEY, [term, ...current.filter((item) => fold(item) !== fold(term))].slice(0, 6));
  }

  function persistSaved() {
    writeJSON(SAVED_KEY, [...state.saved]);
    if ($('savedCount')) $('savedCount').textContent = state.saved.size;
    if ($('savedButton')) {
      $('savedButton').classList.toggle('active', state.savedOnly);
      $('savedButton').setAttribute('aria-pressed', String(state.savedOnly));
    }
  }

  function renderRegions() {
    if (!$('regionSelect')) return;
    $('regionSelect').innerHTML = '<option value="all">Celá Česká republika</option>' + REGIONS.map(([code,name]) => `<option value="${code}">${esc(name)}</option>`).join('');
    $('regionSelect').value = state.region;
    renderCities();
  }

  function renderCities() {
    if (!$('citySelect')) return;
    const cities = [...new Set(state.locationRows.map((row) => row.city_name).filter(Boolean))].sort((a,b) => a.localeCompare(b,'cs'));
    $('citySelect').innerHTML = '<option value="all">Všechna města</option>' + cities.map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('');
    $('citySelect').disabled = state.region === 'all' || !cities.length;
    if (!cities.includes(state.city)) state.city = 'all';
    $('citySelect').value = state.city;
  }

  function groupCountMap() {
    return new Map((Array.isArray(state.facets?.groups) ? state.facets.groups : []).map((row) => [row.filter_group || 'other', Number(row.count || 0)]));
  }

  function renderCategories() {
    const counts = groupCountMap();
    const available = CATEGORY_DEFS.filter(([key]) => counts.get(key) || key === state.category);
    const total = [...counts.values()].reduce((sum, count) => sum + Number(count || 0), 0);
    if ($('categoryChips')) {
      $('categoryChips').innerHTML = `<button class="categoryChip ${state.category === 'all' ? 'active' : ''}" data-category="all"><span class="categoryChipIcon">🛒</span><span class="categoryChipCopy"><strong>Vše</strong><small>${total.toLocaleString('cs-CZ')}</small></span></button>` + available.map(([key,name,icon]) => `<button class="categoryChip ${state.category === key ? 'active' : ''}" data-category="${key}"><span class="categoryChipIcon">${icon}</span><span class="categoryChipCopy"><strong>${esc(name)}</strong><small>${(counts.get(key) || 0).toLocaleString('cs-CZ')}</small></span></button>`).join('');
    }
    if ($('categorySelect')) {
      $('categorySelect').innerHTML = '<option value="all">Všechny kategorie</option>' + available.map(([key,name]) => `<option value="${key}">${esc(name)} (${counts.get(key) || 0})</option>`).join('');
      $('categorySelect').value = state.category;
    }
    if ($('clearCategory')) $('clearCategory').hidden = state.category === 'all';
  }

  function renderStores() {
    const facetStores = Array.isArray(state.facets?.stores) ? state.facets.stores : [];
    const counts = new Map(facetStores.map((store) => [store.slug, Number(store.count || 0)]));
    const metadata = new Map(state.allStores.map((store) => [store.slug, store]));
    facetStores.forEach((store) => metadata.set(store.slug, { ...(metadata.get(store.slug) || {}), ...store }));
    const visible = [...metadata.values()].filter((store) => counts.get(store.slug) || store.slug === state.store).sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'cs'));
    const shown = state.storesExpanded ? visible : visible.slice(0, 11);
    if ($('storeGrid')) {
      $('storeGrid').innerHTML = `<article class="storeCard ${state.store === 'all' ? 'active' : ''}"><button class="storeFilterButton" data-store="all"><div class="storeLogoBox"><span class="storeAllIcon">🏪</span></div>Všechny obchody</button></article>` + shown.map((store) => `<article class="storeCard ${state.store === store.slug ? 'active' : ''}"><a class="storePageLink" href="${encodeURIComponent(store.slug)}.html" title="Otevřít stránku ${esc(store.name)}">↗</a><button class="storeFilterButton" data-store="${esc(store.slug)}"><div class="storeLogoBox">${logoHTML(store)}</div>${esc(store.name)}</button></article>`).join('');
    }
    if ($('showAllStores')) $('showAllStores').textContent = state.storesExpanded ? 'Zobrazit méně' : `Zobrazit všechny (${visible.length})`;
    if ($('storeSelect')) {
      $('storeSelect').innerHTML = '<option value="all">Všechny obchody</option>' + visible.map((store) => `<option value="${esc(store.slug)}">${esc(store.name)} (${counts.get(store.slug) || 0})</option>`).join('');
      $('storeSelect').value = state.store;
    }
  }

  function activeFilterItems() {
    const items = [];
    if (state.query) items.push(['query',`Hledání: ${state.query}`]);
    if (state.store !== 'all') items.push(['store',`Obchod: ${state.allStores.find((item) => item.slug === state.store)?.name || state.store}`]);
    if (state.category !== 'all') items.push(['category',`Kategorie: ${categoryLabel(state.category)}`]);
    if (state.region !== 'all') items.push(['region',`Kraj: ${REGIONS.find((item) => item[0] === state.region)?.[1] || state.region}`]);
    if (state.city !== 'all') items.push(['city',`Město: ${state.city}`]);
    if (state.minPrice !== null) items.push(['minPrice',`Od ${money(state.minPrice)} Kč`]);
    if (state.maxPrice !== null) items.push(['maxPrice',`Do ${money(state.maxPrice)} Kč`]);
    if (state.onlyImages) items.push(['images','Jen s fotografií']);
    if (state.savedOnly) items.push(['saved','Uložené']);
    return items;
  }

  function renderActiveFilters() {
    const items = activeFilterItems();
    if ($('activeFilterCount')) $('activeFilterCount').textContent = items.length;
    if (!$('activeFilters')) return;
    $('activeFilters').hidden = !items.length;
    $('activeFilters').innerHTML = items.map(([key,label]) => `<button class="filterChip" data-clear="${key}">${esc(label)} ×</button>`).join('') + (items.length > 1 ? '<button class="filterChip" data-clear="all">Zrušit vše</button>' : '');
  }

  function miniAdCard(position) {
    return `<aside class="miniAdCard" data-ad-position="${position}" aria-label="Reklamní sdělení"><span class="miniAdLabel">Reklama</span><span class="miniAdMark" aria-hidden="true">%</span><div class="miniAdContent"><strong>Prostor pro vaši nabídku</strong><p>Oslovte zákazníky právě ve chvíli, kdy porovnávají ceny.</p></div><a href="kontakt.html" class="miniAdAction">Inzerovat na Slevao <span aria-hidden="true">→</span></a></aside>`;
  }

  function renderDeals() {
    const rows = state.offers;
    const today = pragueDateKey();
    const store = state.allStores.find((item) => item.slug === state.store);
    const upcomingOnly = rows.length > 0 && rows.every((offer) => isUpcoming(offer, today));
    const nextStart = upcomingOnly ? [...new Set(rows.map((offer) => offer.valid_from).filter(Boolean))].sort()[0] : '';
    const modeTitles = { all:state.query ? `Výsledky pro „${state.query}“` : 'Všechny aktuální nabídky', recommended:upcomingOnly ? 'Akce, které začnou brzy' : 'Nejvýhodnější právě teď', food:'Potraviny v akci', discount:'Největší slevy', ending:'Akce, které končí dnes', new:'Nově přidané nabídky', under50:'Nabídky do 50 Kč', under100:'Nabídky do 100 Kč' };
    if ($('dealsTitle')) $('dealsTitle').textContent = state.savedOnly ? 'Uložené nabídky' : store ? `Akční nabídky – ${store.name}` : (modeTitles[state.mode] || 'Aktuální nabídky');
    if ($('dealsSubtitle')) $('dealsSubtitle').textContent = state.savedOnly ? 'Produkty, které sis uložil v tomto prohlížeči.' : upcomingOnly ? `Tyto nabídky začínají platit ${date(nextStart)}.` : state.mode === 'ending' ? 'Tyto ceny platí naposledy dnes.' : 'Porovnej cenu, úsporu a dobu platnosti.';
    if ($('resultText')) $('resultText').textContent = state.total ? `Zobrazeno ${rows.length} z ${state.total.toLocaleString('cs-CZ')} nabídek` : 'Žádná odpovídající nabídka';
    if ($('loadMoreWrap')) $('loadMoreWrap').hidden = rows.length >= state.total || !state.total;
    renderActiveFilters();
    persistSaved();

    if (!$('dealGrid')) return;
    if (!rows.length) {
      $('dealGrid').innerHTML = `<div class="emptyState"><strong>${state.savedOnly ? 'Zatím nemáš nic uložené' : 'Žádná nabídka neodpovídá filtrům'}</strong><span>${state.savedOnly ? 'Klikni na srdíčko u produktu a nabídka se uloží.' : 'Zkus změnit obchod, kategorii, lokalitu nebo cenové omezení.'}</span></div>`;
      return;
    }

    $('dealGrid').innerHTML = rows.map((offer,index) => {
      const storeData = state.allStores.find((item) => item.slug === offer.stores?.slug) || offer.stores || {};
      const discount = discountOf(offer), saving = savingOf(offer), saved = state.saved.has(String(offer.id));
      const quantity = compactQuantity(offer.products?.quantity_text) || quantityInfo(offer)?.label || '';
      const brand = offer.products?.brand || '';
      const purchaseCondition = bulkPurchaseLabel(offer.description);
      const location = leafletLocation(offer);
      const card = `<article class="dealCard"><div class="dealMedia">${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.products?.name || offer.title || 'Produkt')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'dealPlaceholder',textContent:'🏷️'}))">` : '<span class="dealPlaceholder">🏷️</span>'}${discount ? `<span class="discountBadge">−${discount} %</span>` : ''}${isUpcoming(offer, today) ? `<span class="endingBadge">Platí od ${date(offer.valid_from)}</span>` : offer.valid_to === today ? '<span class="endingBadge">Končí dnes</span>' : ''}<button class="dealMenu" data-report-id="${esc(offer.id)}" title="Nahlásit problém">⋯</button><button class="saveOffer ${saved ? 'active' : ''}" data-save-id="${esc(offer.id)}" aria-label="${saved ? 'Odebrat z uložených' : 'Uložit nabídku'}">${saved ? '♥' : '♡'}</button></div><div class="dealBody"><div class="storeLine">${logoHTML(storeData)}<span>${esc(offer.stores?.name || 'Obchod')}</span></div><h3>${esc(offer.products?.name || offer.title || 'Produkt')}</h3><div class="productDetail">${esc([brand,quantity,purchaseCondition].filter(Boolean).join(' · ') || offer.categories?.name || '')}</div><div class="priceRow"><span class="price">${money(offer.price)} Kč</span>${oldPriceOf(offer) ? `<span class="oldPrice">${money(offer.old_price)} Kč</span>` : ''}</div>${unitPrice(offer) ? `<div class="unitPrice">${unitPrice(offer)}</div>` : ''}${saving ? `<span class="saving">Ušetříš ${money(saving)} Kč</span>` : ''}<div class="dealActions"><button class="compareButton" data-compare-id="${esc(offer.id)}" ${offer.product_id ? '' : 'disabled'}>${offer.product_id ? 'Porovnat' : 'Bez porovnání'}</button><a class="storeButton" href="${encodeURIComponent(offer.stores?.slug || '')}.html">Stránka obchodu</a></div><div class="validity">Platí ${date(offer.valid_from)}–${date(offer.valid_to)}</div>${location ? `<a class="leafletLocationButton" href="${esc(location.url)}" target="_blank" rel="noopener noreferrer" aria-label="Ukázat produkt v letáku na straně ${location.page}"><span>📄</span> Leták · strana ${location.page}</a>` : ''}<div class="sourceLine">Zdroj: nabídka obchodu · aktualizováno průběžně</div></div></article>`;
      return card + ((index + 1) % 10 === 0 ? miniAdCard(index + 1) : '');
    }).join('');
  }

  function renderAll() {
    renderRegions(); renderCategories(); renderStores(); renderDeals();
    document.querySelectorAll('.quickTab').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  }

  function setBusy(value) {
    state.loading = value;
    $('dealsSection')?.setAttribute('aria-busy', String(value));
    if ($('loadMore')) $('loadMore').disabled = value;
  }

  async function refreshCurrent({ append=false, refreshFacets=true, scroll=false, facetsPromise=null } = {}) {
    const version = ++state.requestVersion;
    setBusy(true);
    try {
      const offset = append ? state.offers.length : 0;
      const facetsTask = refreshFacets
        ? Promise.resolve(facetsPromise || fetchFacets()).catch((error) => {
            console.warn('Facety nabídek se nepodařilo načíst:', error);
            return state.facets;
          })
        : Promise.resolve(state.facets);
      const [page, facets] = await Promise.all([
        fetchPage(offset),
        facetsTask
      ]);
      if (version !== state.requestVersion) return;
      state.offers = append ? [...state.offers, ...page.offers] : page.offers;
      state.total = page.total;
      if (facets) state.facets = facets;
      renderAll();
      if (scroll) $('dealsSection')?.scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) {
      console.error(error);
      if (version !== state.requestVersion) return;
      if (!state.offers.length && $('dealGrid')) $('dealGrid').innerHTML = `<div class="errorState"><strong>Data se nepodařilo načíst</strong><span>${esc(error.message || 'Zkontroluj připojení a zkus to znovu.')}</span><button class="primaryButton" onclick="location.reload()">Načíst znovu</button></div>`;
      if ($('statusPill')) $('statusPill').textContent = 'Nabídky se nepodařilo načíst';
    } finally {
      if (version === state.requestVersion) setBusy(false);
    }
  }

  function resetFilters() {
    Object.assign(state, { query:'',store:'all',category:'all',region:'all',city:'all',minPrice:null,maxPrice:null,onlyImages:false,mode:'recommended',sort:'recommended',savedOnly:false });
    state.locationRows = [];
    state.locationVersion += 1;
    if ($('q')) $('q').value = '';
    if ($('sideSearch')) $('sideSearch').value = '';
    if ($('minPrice')) $('minPrice').value = '';
    if ($('maxPrice')) $('maxPrice').value = '';
    if ($('onlyImages')) $('onlyImages').checked = false;
    if ($('sortSelect')) $('sortSelect').value = 'recommended';
    renderRegions();
    refreshCurrent();
  }

  function clearFilter(key) {
    if (key === 'all') { resetFilters(); return; }
    if (key === 'query') { state.query=''; if (state.mode === 'all') state.mode='recommended'; if ($('q')) $('q').value=''; if ($('sideSearch')) $('sideSearch').value=''; }
    if (key === 'store') state.store='all';
    if (key === 'category') { state.category='all'; if (state.mode === 'food') state.mode='all'; }
    if (key === 'region') { state.region='all'; state.city='all'; state.locationRows=[]; state.locationVersion += 1; }
    if (key === 'city') state.city='all';
    if (key === 'minPrice') { state.minPrice=null; if ($('minPrice')) $('minPrice').value=''; }
    if (key === 'maxPrice') { state.maxPrice=null; if ($('maxPrice')) $('maxPrice').value=''; }
    if (key === 'images') { state.onlyImages=false; if ($('onlyImages')) $('onlyImages').checked=false; }
    if (key === 'saved') state.savedOnly=false;
    refreshCurrent();
  }

  async function toggleSaved(id) {
    const key = String(id);
    state.saved.has(key) ? state.saved.delete(key) : state.saved.add(key);
    persistSaved();
    if (state.savedOnly) await refreshCurrent({ refreshFacets:false });
    else renderDeals();
  }

  async function openCompare(id) {
    const source = state.offers.find((item) => String(item.id) === String(id));
    if (!source?.product_id) return;
    if ($('compareTitle')) $('compareTitle').textContent = source.products?.name || source.title || 'Porovnat produkt';
    if ($('compareContent')) $('compareContent').innerHTML = '<div class="sfLoading">Načítám porovnání…</div>';
    if ($('compareModal')) $('compareModal').hidden = false;
    document.body.style.overflow = 'hidden';
    try {
      const rows = await rpc('get_public_product_comparison', {
        p_product_id:source.product_id,
        p_region_code:state.region === 'all' ? null : state.region,
        p_city_name:state.city === 'all' ? null : state.city
      });
      const matches = (Array.isArray(rows) ? rows : []).map((row) => normalizeOffer(row.offer));
      if ($('compareContent')) $('compareContent').innerHTML = matches.length > 1 ? `<div class="compareList">${matches.map((item,index) => `<article class="compareRow ${index === 0 ? 'best' : ''}"><div><strong>${esc(item.stores?.name || 'Obchod')}${index === 0 ? ' · nejlevnější' : ''}</strong><small>${esc(item.products?.quantity_text || '')} · platí do ${date(item.valid_to)}</small></div><strong class="price">${money(item.price)} Kč</strong></article>`).join('')}</div>` : '<div class="emptyState"><strong>Další nabídka nebyla nalezena</strong><span>Produkt je nyní dostupný jen v jednom obchodě.</span></div>';
    } catch (error) {
      if ($('compareContent')) $('compareContent').innerHTML = `<div class="errorState"><strong>Porovnání se nepodařilo načíst</strong><span>${esc(error.message)}</span></div>`;
    }
  }

  function openReport(id = '') {
    state.reportOffer = state.offers.find((item) => String(item.id) === String(id)) || null;
    if ($('reportProduct')) $('reportProduct').textContent = state.reportOffer ? `${state.reportOffer.title} · ${state.reportOffer.stores?.name || ''} · ${money(state.reportOffer.price)} Kč` : 'Obecné hlášení k webu Slevao.cz';
    if ($('reportNote')) $('reportNote').value = '';
    if ($('reportModal')) $('reportModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    if ($(id)) $(id).hidden = true;
    if ([...document.querySelectorAll('.modal')].every((modal) => modal.hidden)) document.body.style.overflow = '';
  }

  function sendReport() {
    const offer = state.reportOffer;
    const subject = encodeURIComponent(`Slevao.cz – ${$('reportType')?.value || 'Hlášení'}`);
    const body = encodeURIComponent([
      `Typ problému: ${$('reportType')?.value || ''}`, offer ? `Produkt: ${offer.title}` : '', offer ? `Obchod: ${offer.stores?.name || ''}` : '',
      offer ? `Cena: ${money(offer.price)} Kč` : '', offer ? `ID nabídky: ${offer.id}` : '', `Poznámka: ${$('reportNote')?.value.trim() || 'bez poznámky'}`, `Stránka: ${location.href}`
    ].filter(Boolean).join('\
'));
    location.href = `mailto:info@slevao.cz?subject=${subject}&body=${body}`;
    closeModal('reportModal'); toast('Hlášení je připravené v e-mailu.');
  }

  async function renderSuggestions() {
    const box = $('searchSuggestions');
    if (!box) return;
    const version = ++state.suggestionsVersion;
    const term = $('q')?.value.trim() || '';
    let rows = [];
    if (term) {
      try {
        const result = await rpc('get_public_offer_page_filtered', pagePayload(0, 7, term));
        if (version !== state.suggestionsVersion) return;
        rows = (Array.isArray(result) ? result : []).map((row) => normalizeOffer(row.offer));
      } catch { rows = []; }
    } else {
      rows = state.offers.slice(0, 7);
    }
    const recent = readJSON(RECENT_KEY, []);
    if (!rows.length && !recent.length) { box.hidden = true; return; }
    box.innerHTML = (term ? `<div class="suggestHead">Nejlepší shody pro „${esc(term)}“</div>` : '<div class="suggestHead">Doporučené nabídky</div>') + rows.map((offer,index) => `<button class="suggestItem" data-suggest-title="${esc(offer.title)}" data-index="${index}"><span class="suggestThumb">${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="">` : '🏷️'}</span><span><strong>${esc(offer.title)}</strong><small>${esc(offer.stores?.name || '')}</small></span><span class="suggestPrice">${money(offer.price)} Kč</span></button>`).join('') + (!term && recent.length ? `<div class="suggestHead">Poslední hledání</div>${recent.map((item) => `<button class="suggestItem" data-suggest-title="${esc(item)}"><span class="suggestThumb">⌕</span><span><strong>${esc(item)}</strong><small>Hledat znovu</small></span></button>`).join('')}` : '');
    box.hidden = false;
  }

  async function applySearch(value, scroll = true) {
    state.query = String(value || '').trim();
    state.mode = state.query ? 'all' : 'recommended';
    state.category = 'all';
    if ($('q')) $('q').value = state.query;
    if ($('sideSearch')) $('sideSearch').value = state.query;
    saveRecent(state.query);
    if ($('searchSuggestions')) $('searchSuggestions').hidden = true;
    await refreshCurrent({ scroll });
  }

  function scrollToDealsAfterStoreLayout() {
    const target = $('dealsSection');
    if (!target) return;
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ behavior:'smooth', block:'start' })));
  }

  function bindEvents() {
    $('searchButton')?.addEventListener('click', () => applySearch($('q')?.value || ''));
    $('q')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') applySearch(event.target.value); if (event.key === 'Escape' && $('searchSuggestions')) $('searchSuggestions').hidden=true; });
    $('q')?.addEventListener('focus', renderSuggestions);
    let suggestTimer=0;
    $('q')?.addEventListener('input', () => { clearTimeout(suggestTimer); suggestTimer=window.setTimeout(renderSuggestions,180); });
    $('searchSuggestions')?.addEventListener('click', (event) => { const button=event.target.closest('[data-suggest-title]'); if (button) applySearch(button.dataset.suggestTitle); });
    document.addEventListener('click', (event) => { if (!event.target.closest('.mainSearch') && $('searchSuggestions')) $('searchSuggestions').hidden=true; });

    let sideTimer=0;
    $('sideSearch')?.addEventListener('input', (event) => {
      state.query=event.target.value.trim(); state.mode=state.query ? 'all' : 'recommended'; state.category='all';
      if ($('q')) $('q').value=state.query;
      clearTimeout(sideTimer); sideTimer=window.setTimeout(() => refreshCurrent(),220);
    });

    $('savedButton')?.addEventListener('click', () => { state.savedOnly=!state.savedOnly; refreshCurrent({ refreshFacets:!state.savedOnly, scroll:true }); });
    $('mobileSaved')?.addEventListener('click', () => $('savedButton')?.click());
    $('categoryChips')?.addEventListener('click', (event) => { const button=event.target.closest('[data-category]'); if (!button) return; state.category=button.dataset.category; if (state.mode==='food' && state.category!=='food') state.mode='all'; refreshCurrent({ scroll:true }); });
    $('clearCategory')?.addEventListener('click', () => { state.category='all'; if (state.mode==='food') state.mode='all'; refreshCurrent(); });

    document.addEventListener('click', (event) => {
      const storeButton=event.target.closest('[data-store]');
      if (storeButton) { state.store=storeButton.dataset.store; refreshCurrent().then(scrollToDealsAfterStoreLayout); }
      const saveButton=event.target.closest('[data-save-id]'); if (saveButton) toggleSaved(saveButton.dataset.saveId);
      const compareButton=event.target.closest('[data-compare-id]'); if (compareButton && !compareButton.disabled) openCompare(compareButton.dataset.compareId);
      const reportButton=event.target.closest('[data-report-id]'); if (reportButton) openReport(reportButton.dataset.reportId);
      const clearButton=event.target.closest('[data-clear]'); if (clearButton) clearFilter(clearButton.dataset.clear);
      const modalClose=event.target.closest('[data-close-modal]'); if (modalClose) closeModal(modalClose.dataset.closeModal);
    });

    $('showAllStores')?.addEventListener('click', () => { state.storesExpanded=!state.storesExpanded; renderStores(); });
    $('quickTabs')?.addEventListener('click', (event) => {
      const button=event.target.closest('[data-mode]'); if (!button) return;
      state.mode=button.dataset.mode;
      if (state.mode==='food') state.category='food'; else if (state.category==='food') state.category='all';
      refreshCurrent({ scroll:true });
    });
    $('sortSelect')?.addEventListener('change', (event) => { state.sort=event.target.value; refreshCurrent({ refreshFacets:false }); });
    $('storeSelect')?.addEventListener('change', (event) => { state.store=event.target.value; refreshCurrent(); });
    $('categorySelect')?.addEventListener('change', (event) => { state.category=event.target.value; if (state.category!=='food' && state.mode==='food') state.mode='all'; refreshCurrent(); });
    $('regionSelect')?.addEventListener('change', async (event) => {
      state.region=event.target.value;
      state.city='all';
      state.locationRows=[];
      renderCities();
      const applied = await loadLocationRows();
      if (!applied) return;
      renderCities();
      await refreshCurrent();
    });
    $('citySelect')?.addEventListener('change', (event) => { state.city=event.target.value; refreshCurrent(); });
    $('minPrice')?.addEventListener('input', (event) => { state.minPrice=event.target.value==='' ? null : Math.max(0,Number(event.target.value)); clearTimeout(sideTimer); sideTimer=window.setTimeout(() => refreshCurrent(),220); });
    $('maxPrice')?.addEventListener('input', (event) => { state.maxPrice=event.target.value==='' ? null : Math.max(0,Number(event.target.value)); clearTimeout(sideTimer); sideTimer=window.setTimeout(() => refreshCurrent(),220); });
    document.querySelectorAll('[data-max-price]').forEach((button) => button.addEventListener('click', () => { state.maxPrice=Number(button.dataset.maxPrice); if ($('maxPrice')) $('maxPrice').value=state.maxPrice; refreshCurrent(); }));
    $('onlyImages')?.addEventListener('change', (event) => { state.onlyImages=event.target.checked; refreshCurrent(); });
    $('resetFilters')?.addEventListener('click', resetFilters);
    $('loadMore')?.addEventListener('click', () => refreshCurrent({ append:true, refreshFacets:false }));
    $('filterToggle')?.addEventListener('click', () => $('filterPanel')?.classList.add('open'));
    $('filterClose')?.addEventListener('click', () => $('filterPanel')?.classList.remove('open'));
    $('footerReport')?.addEventListener('click', () => openReport());
    $('sendReport')?.addEventListener('click', sendReport);
    document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target===modal) closeModal(modal.id); }));
    document.addEventListener('keydown', (event) => { if (event.key==='Escape') document.querySelectorAll('.modal:not([hidden])').forEach((modal) => closeModal(modal.id)); });
  }

  function statusDate(value) {
    const parsed = new Date(Number(value) || value || Date.now());
    const key = pragueDateKey(parsed);
    const formatted = new Intl.DateTimeFormat('cs-CZ', { timeZone:'Europe/Prague', day:'numeric', month:'numeric' }).format(parsed);
    return `${key === pragueDateKey() ? 'dnes ' : ''}${formatted}`;
  }

  function renderUpdateStatus(updatedAt = Date.now()) {
    const pill = $('statusPill');
    if (!pill) return;
    pill.dataset.richStatus='true';
    pill.setAttribute('aria-label',`Aktualizováno, ${statusDate(updatedAt)}`);
    pill.innerHTML=`<span class="statusPillCopy"><span class="statusPillLabel">Aktualizováno</span><strong class="statusPillDate">${statusDate(updatedAt)}</strong></span>`;
  }

  async function load() {
    if ($('q')) $('q').value=state.query;
    if ($('sideSearch')) $('sideSearch').value=state.query;
    renderRegions();
    try {
      const globalFacetsPromise = loadGlobalFacets().catch((error) => {
        console.warn('Globální facety se nepodařilo načíst:', error);
        return state.globalFacets;
      });
      await Promise.all([
        globalFacetsPromise,
        refreshCurrent({ facetsPromise: initialQuery ? null : globalFacetsPromise })
      ]);
      renderUpdateStatus(Date.now());
    } catch (error) {
      console.error(error);
      if ($('statusPill')) $('statusPill').textContent='Nabídky se nepodařilo načíst';
    }
  }

  bindEvents();
  persistSaved();
  load();
})();
