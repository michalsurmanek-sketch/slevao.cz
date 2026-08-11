(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const CACHE_KEY = 'slevao-home-v2-data-verified-upcoming-v2';
  const SAVED_KEY = 'slevao-saved';
  const RECENT_KEY = 'slevao-recent-searches';
  const PAGE_SIZE = 24;
  const TODAY = new Date().toISOString().slice(0, 10);
  const UPCOMING_DAYS = 7;
  const UPCOMING_TO = new Date(Date.now() + UPCOMING_DAYS * 86400000).toISOString().slice(0, 10);
  const isUpcoming = (offer) => String(offer?.valid_from || '') > TODAY;
  const REGIONS = [
    ['CZ010','Hlavní město Praha'],['CZ020','Středočeský kraj'],['CZ031','Jihočeský kraj'],['CZ032','Plzeňský kraj'],
    ['CZ041','Karlovarský kraj'],['CZ042','Ústecký kraj'],['CZ051','Liberecký kraj'],['CZ052','Královéhradecký kraj'],
    ['CZ053','Pardubický kraj'],['CZ063','Kraj Vysočina'],['CZ064','Jihomoravský kraj'],['CZ071','Olomoucký kraj'],
    ['CZ072','Zlínský kraj'],['CZ080','Moravskoslezský kraj']
  ];
  const CATEGORY_DEFS = [
    ['food','Potraviny','🥫',['potrav','maso','masov','vepr','hovez','kurec','krkovic','kyta','kotlet','svickov','stehno','prsa','sunka','uzen','salám','klobas','parek','ryba','losos','tresk','peciv','chleb','rohlik','mleko','syr','jogurt','maslo','vejce','ovoce','zelenina','brambor','cibul','rajcat','paprik','cokol','cukr','mouka','ryze','testovin']],
    ['drinks','Nápoje','🥤',['napoj','voda','cola','limon','dzus','juice','pivo','vino','kava','caj','sirup','energy']],
    ['drugstore','Drogerie','🧴',['droger','sampon','mydlo','praci','avivaz','zubni','plenk','toaletni papir','cistic','kosmetik','deodor']],
    ['home','Domácnost','🏠',['domac','kuchyn','nadob','uklid','dekor','svick','rucnik','povlec','nabytek','skrin','postel','stul','zidle','sedack','drez','dlazb','naradi','mlynek','svitidlo','zarovk']],
    ['electronics','Elektronika','🔌',['elektr','telefon','mobil','notebook','televiz','sluchat','pocitac','tablet','monitor','kabel']],
    ['garden','Zahrada','🌿',['zahrad','sekac','substrat','kvetin','gril','cerpadlo','hadice','komposter']],
    ['fashion','Oblečení','👕',['oblec','tricko','kalhot','bunda','boty','ponoz','mikina','saty','sukne','kosile']],
    ['pharmacy','Lékárna','💊',['lekar','vitam','leciv','tablety','kapsle','zdravi','mast']],
    ['pets','Zvířata','🐾',['krmivo','granule','stelivo','mazlic','pro psy','pro kocky','whiskas','pedigree','purina']],
    ['other','Ostatní','🏷️',[]]
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
  const priceOf = (offer) => Number(offer.price || 0);
  const oldPriceOf = (offer) => Number(offer.old_price || 0);
  const savingOf = (offer) => Math.max(0, oldPriceOf(offer) - priceOf(offer));
  const discountOf = (offer) => oldPriceOf(offer) > priceOf(offer) ? Math.round(savingOf(offer) / oldPriceOf(offer) * 100) : 0;
  const normalizeName = (value) => fold(value).replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks|bal|baleni)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } };
  const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

  const state = {
    stores: [], offers: [], query:'', store:'all', category:'all', region:'all', city:'all',
    minPrice:null, maxPrice:null, onlyImages:false, mode:'recommended', sort:'recommended',
    savedOnly:false, saved:new Set(readJSON(SAVED_KEY, []).map(String)), visible:PAGE_SIZE, storesExpanded:false,
    reportOffer:null
  };

  function toast(message) {
    const box = $('toast');
    box.textContent = message; box.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { box.hidden = true; }, 2800);
  }

  function storeLogoCandidates(store) {
    const list = [];
    if (LOCAL_LOGOS[store.slug]) list.push(new URL(LOCAL_LOGOS[store.slug], document.baseURI).href);
    if (store.logo_url) list.push(store.logo_url);
    const domain = STORE_DOMAINS[store.slug];
    if (domain) list.push(`https://logo.clearbit.com/${domain}?size=256`, `https://www.google.com/s2/favicons?sz=256&domain_url=https://${domain}`);
    return [...new Set(list.filter(Boolean))];
  }

  function logoHTML(store, className = '') {
    const list = storeLogoCandidates(store);
    if (!list.length) return `<span class="storeAllIcon">🏪</span>`;
    return `<img class="${className}" src="${esc(list[0])}" data-logo-list="${esc(JSON.stringify(list))}" data-logo-index="0" alt="Logo ${esc(store.name)}" loading="lazy" onerror="window.slevaoLogoError(this)">`;
  }

  window.slevaoLogoError = (img) => {
    let list = [];
    try { list = JSON.parse(img.dataset.logoList || '[]'); } catch {}
    const next = Number(img.dataset.logoIndex || 0) + 1;
    if (next < list.length) { img.dataset.logoIndex = String(next); img.src = list[next]; return; }
    img.replaceWith(Object.assign(document.createElement('span'), { className:'storeAllIcon', textContent:'🏪' }));
  };

  async function rest(table, params = {}, range = '') {
    const query = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        headers: { apikey:SUPABASE_KEY, ...(range ? { Range:range } : {}) },
        cache:'no-store', signal:controller.signal
      });
      if (!response.ok) throw new Error(`Databáze vrátila chybu ${response.status}.`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  async function fetchOffers() {
    const richSelect = 'id,product_id,store_id,category_id,title,price,old_price,image_url,valid_from,valid_to,published_at,coverage_scope,region_code,city_name,store_location_name,is_verified,metadata,stores(name,slug,logo_url,primary_color),products(name,brand,quantity_text,image_url),categories(name,slug)';
    const simpleSelect = 'id,product_id,store_id,title,price,old_price,image_url,valid_from,valid_to,published_at,is_verified,metadata,stores(name,slug,logo_url,primary_color),products(name,brand,quantity_text,image_url)';
    const collect = async (select) => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const batch = await rest('offers', { select, status:'eq.published', is_verified:'eq.true', valid_from:`lte.${UPCOMING_TO}`, valid_to:`gte.${TODAY}`, order:'published_at.desc' }, `${from}-${from + 999}`);
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
      return rows;
    };
    try { return await collect(richSelect); } catch (error) { console.warn('Používám zjednodušený feed:', error); return collect(simpleSelect); }
  }

  function deduplicate(rows) {
    const result = new Map();
    rows.forEach((row) => {
      row.image_url = row.image_url || row.products?.image_url || null;
      row._category = categoryOf(row);
      const key = [row.stores?.slug, normalizeName(row.title || row.products?.name), row.valid_from, row.valid_to].join('|');
      const current = result.get(key);
      if (!current || (!current.image_url && row.image_url)) result.set(key, row);
    });
    return [...result.values()];
  }

  function categoryOf(offer) {
    const explicit = offer.categories?.slug || offer.categories?.name;
    if (explicit) {
      const value = fold(explicit);
      const found = CATEGORY_DEFS.find(([key,name,,words]) => key !== 'other' && (value.includes(fold(name)) || words.some((word) => value.includes(fold(word)))));
      if (found) return found[0];
    }

    const haystack = fold([offer.title, offer.products?.name, offer.products?.brand, offer.products?.quantity_text].filter(Boolean).join(' '));
    const priority = ['electronics','pharmacy','pets','fashion','drugstore','garden','home','drinks','food'];
    const foundKey = priority.find((key) => {
      const definition = CATEGORY_DEFS.find((item) => item[0] === key);
      return definition?.[3].some((word) => haystack.includes(fold(word)));
    });
    return foundKey || 'other';
  }

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

  function compareKey(offer) {
    return offer.product_id || normalizeName(offer.products?.name || offer.title);
  }

  function leafletLocation(offer) {
    const page = Number(offer?.metadata?.leaflet_page || 0);
    const documentUrl = String(offer?.metadata?.leaflet_document_url || '');
    if (!Number.isInteger(page) || page < 1 || page > 500 || !/^https:\/\/.*\.pdf(?:\?|$)/i.test(documentUrl)) return null;
    return { page, url: `${documentUrl}#page=${page}&zoom=page-fit` };
  }

  function geographyMatches(offer) {
    const scope = offer.coverage_scope || 'national';
    if (scope === 'national' || state.region === 'all') return true;
    if (offer.region_code && offer.region_code !== state.region) return false;
    if (state.city !== 'all' && offer.city_name && fold(offer.city_name) !== fold(state.city)) return false;
    return true;
  }

  function filteredOffers() {
    let rows = state.offers.filter(geographyMatches);
    if (state.store !== 'all') rows = rows.filter((offer) => offer.stores?.slug === state.store);
    if (state.category !== 'all') rows = rows.filter((offer) => offer._category === state.category);
    if (state.query) {
      const query = fold(state.query);
      rows = rows.filter((offer) => fold([offer.title, offer.products?.name, offer.products?.brand, offer.products?.quantity_text, offer.stores?.name, offer.categories?.name].join(' ')).includes(query));
    }
    if (state.minPrice !== null) rows = rows.filter((offer) => priceOf(offer) >= state.minPrice);
    if (state.maxPrice !== null) rows = rows.filter((offer) => priceOf(offer) <= state.maxPrice);
    if (state.onlyImages) rows = rows.filter((offer) => Boolean(offer.image_url));
    if (state.savedOnly) rows = rows.filter((offer) => state.saved.has(String(offer.id)));
    if (state.mode === 'ending') rows = rows.filter((offer) => offer.valid_to === TODAY);
    if (state.mode === 'under50') rows = rows.filter((offer) => priceOf(offer) <= 50);
    if (state.mode === 'under100') rows = rows.filter((offer) => priceOf(offer) <= 100);
    return sortOffers(rows);
  }

  function sortOffers(rows) {
    const output = [...rows];
    const mode = state.mode === 'discount' ? 'discount' : state.mode === 'new' ? 'newest' : state.mode === 'ending' ? 'ending' : state.sort;
    return output.sort((a, b) => {
      const upcomingOrder = Number(isUpcoming(a)) - Number(isUpcoming(b));
      if (upcomingOrder) return upcomingOrder;
      if (mode === 'discount') return discountOf(b) - discountOf(a) || savingOf(b) - savingOf(a);
      if (mode === 'saving') return savingOf(b) - savingOf(a);
      if (mode === 'ending') return String(a.valid_to).localeCompare(String(b.valid_to));
      if (mode === 'newest') return String(b.published_at || '').localeCompare(String(a.published_at || ''));
      if (mode === 'priceAsc') return priceOf(a) - priceOf(b);
      if (mode === 'priceDesc') return priceOf(b) - priceOf(a);
      if (mode === 'name') return String(a.title || '').localeCompare(String(b.title || ''), 'cs');
      return (discountOf(b) * 2 + Math.min(savingOf(b), 100)) - (discountOf(a) * 2 + Math.min(savingOf(a), 100));
    });
  }

  function saveRecent(value) {
    const term = String(value || '').trim();
    if (!term) return;
    const current = readJSON(RECENT_KEY, []);
    writeJSON(RECENT_KEY, [term, ...current.filter((item) => fold(item) !== fold(term))].slice(0, 6));
  }

  function persistSaved() {
    writeJSON(SAVED_KEY, [...state.saved]);
    $('savedCount').textContent = state.saved.size;
    $('savedButton').classList.toggle('active', state.savedOnly);
    $('savedButton').setAttribute('aria-pressed', String(state.savedOnly));
  }

  function renderRegions() {
    $('regionSelect').innerHTML = '<option value="all">Celá Česká republika</option>' + REGIONS.map(([code,name]) => `<option value="${code}">${esc(name)}</option>`).join('');
    $('regionSelect').value = state.region;
    renderCities();
  }

  function renderCities() {
    const cities = [...new Set(state.offers.filter((offer) => state.region === 'all' || offer.region_code === state.region).map((offer) => offer.city_name).filter(Boolean))].sort((a,b) => a.localeCompare(b,'cs'));
    $('citySelect').innerHTML = '<option value="all">Všechna města</option>' + cities.map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('');
    $('citySelect').disabled = state.region === 'all' || !cities.length;
    if (!cities.includes(state.city)) state.city = 'all';
    $('citySelect').value = state.city;
  }

  function renderCategories() {
    const counts = new Map();
    state.offers.forEach((offer) => counts.set(offer._category, (counts.get(offer._category) || 0) + 1));
    const available = CATEGORY_DEFS.filter(([key]) => counts.get(key));
    $('categoryChips').innerHTML = `<button class="categoryChip ${state.category === 'all' ? 'active' : ''}" data-category="all"><span>✨</span>Vše</button>` + available.map(([key,name,icon]) => `<button class="categoryChip ${state.category === key ? 'active' : ''}" data-category="${key}"><span>${icon}</span>${esc(name)} <small>${counts.get(key)}</small></button>`).join('');
    $('categorySelect').innerHTML = '<option value="all">Všechny kategorie</option>' + available.map(([key,name]) => `<option value="${key}">${esc(name)}</option>`).join('');
    $('categorySelect').value = state.category;
    $('clearCategory').hidden = state.category === 'all';
  }

  function renderStores() {
    const activeSlugs = new Set(state.offers.map((offer) => offer.stores?.slug).filter(Boolean));
    const visibleStores = state.stores.filter((store) => activeSlugs.has(store.slug));
    const shown = state.storesExpanded ? visibleStores : visibleStores.slice(0, 11);
    $('storeGrid').innerHTML = `<article class="storeCard ${state.store === 'all' ? 'active' : ''}"><button class="storeFilterButton" data-store="all"><div class="storeLogoBox"><span class="storeAllIcon">🏪</span></div>Všechny obchody</button></article>` + shown.map((store) => `<article class="storeCard ${state.store === store.slug ? 'active' : ''}"><a class="storePageLink" href="${encodeURIComponent(store.slug)}.html" title="Otevřít stránku ${esc(store.name)}">↗</a><button class="storeFilterButton" data-store="${esc(store.slug)}"><div class="storeLogoBox">${logoHTML(store)}</div>${esc(store.name)}</button></article>`).join('');
    $('showAllStores').textContent = state.storesExpanded ? 'Zobrazit méně' : `Zobrazit všechny (${visibleStores.length})`;
    $('storeSelect').innerHTML = '<option value="all">Všechny obchody</option>' + visibleStores.map((store) => `<option value="${esc(store.slug)}">${esc(store.name)}</option>`).join('');
    $('storeSelect').value = state.store;
    $('storeCount').textContent = visibleStores.length;
  }

  function renderLeaflets() {
    const cards = state.stores.map((store) => {
      const offers = state.offers.filter((offer) => offer.stores?.slug === store.slug);
      if (!offers.length) return null;
      const preview = offers.find((offer) => offer.image_url) || offers[0];
      const validTo = offers.map((offer) => offer.valid_to).filter(Boolean).sort().at(-1);
      return { store, offers, preview, validTo };
    }).filter(Boolean).sort((a,b) => b.offers.length - a.offers.length).slice(0, 8);
    $('leafletGrid').innerHTML = cards.length ? cards.map(({store,offers,preview,validTo}) => `<article class="leafletCard"><div class="leafletCover">${preview.image_url ? `<img class="productPreview" src="${esc(preview.image_url)}" alt="${esc(preview.title)}" loading="lazy" onerror="this.remove()">` : '<span class="dealPlaceholder">🏷️</span>'}${logoHTML(store,'leafletStoreLogo')}<span class="leafletBadge">${offers.length} akcí</span></div><div class="leafletBody"><h3>${esc(store.name)}</h3><div class="leafletMeta"><span>Aktuální nabídky</span><span>do ${date(validTo)}</span></div><div class="leafletAction"><button class="textButton" data-store="${esc(store.slug)}">Zobrazit akce</button><a href="${encodeURIComponent(store.slug)}.html">Prolistovat ↗</a></div></div></article>`).join('') : '<div class="emptyState"><strong>Aktuální letáky se načítají</strong><span>Jakmile budou dostupné platné nabídky, zobrazí se zde.</span></div>';
  }

  function activeFilterItems() {
    const items = [];
    if (state.query) items.push(['query',`Hledání: ${state.query}`]);
    if (state.store !== 'all') items.push(['store',`Obchod: ${state.stores.find((item) => item.slug === state.store)?.name || state.store}`]);
    if (state.category !== 'all') items.push(['category',`Kategorie: ${CATEGORY_DEFS.find((item) => item[0] === state.category)?.[1] || state.category}`]);
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
    $('activeFilterCount').textContent = items.length;
    $('activeFilters').hidden = !items.length;
    $('activeFilters').innerHTML = items.map(([key,label]) => `<button class="filterChip" data-clear="${key}">${esc(label)} ×</button>`).join('') + (items.length > 1 ? '<button class="filterChip" data-clear="all">Zrušit vše</button>' : '');
  }

  function renderDeals() {
    const rows = filteredOffers();
    const visible = rows.slice(0, state.visible);
    const store = state.stores.find((item) => item.slug === state.store);
    const upcomingOnly = rows.length > 0 && rows.every(isUpcoming);
    const nextStart = upcomingOnly ? [...new Set(rows.map((offer) => offer.valid_from).filter(Boolean))].sort()[0] : '';
    const modeTitles = { recommended: upcomingOnly ? 'Akce, které začnou brzy' : 'Nejvýhodnější právě teď', discount:'Největší slevy', ending:'Akce, které končí dnes', new:'Nově přidané nabídky', under50:'Nabídky do 50 Kč', under100:'Nabídky do 100 Kč' };
    $('dealsTitle').textContent = state.savedOnly ? 'Uložené nabídky' : store ? `Akční nabídky – ${store.name}` : modeTitles[state.mode];
    $('dealsSubtitle').textContent = state.savedOnly ? 'Produkty, které sis uložil v tomto prohlížeči.' : upcomingOnly ? `Tyto nabídky začínají platit ${date(nextStart)}.` : state.mode === 'ending' ? 'Tyto ceny platí naposledy dnes.' : 'Porovnej cenu, úsporu a dobu platnosti.';
    $('resultText').textContent = rows.length ? `Zobrazeno ${Math.min(visible.length, rows.length)} z ${rows.length} nabídek` : 'Žádná odpovídající nabídka';
    $('loadMoreWrap').hidden = visible.length >= rows.length;
    renderActiveFilters(); persistSaved();
    if (!visible.length) {
      $('dealGrid').innerHTML = `<div class="emptyState"><strong>${state.savedOnly ? 'Zatím nemáš nic uložené' : 'Žádná nabídka neodpovídá filtrům'}</strong><span>${state.savedOnly ? 'Klikni na srdíčko u produktu a nabídka se uloží.' : 'Zkus změnit obchod, kategorii, lokalitu nebo cenové omezení.'}</span></div>`;
      return;
    }
    const groups = new Map();
    state.offers.forEach((offer) => { const key = compareKey(offer); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(offer); });
    $('dealGrid').innerHTML = visible.map((offer) => {
      const storeData = state.stores.find((item) => item.slug === offer.stores?.slug) || offer.stores || {};
      const discount = discountOf(offer), saving = savingOf(offer), saved = state.saved.has(String(offer.id));
      const quantity = offer.products?.quantity_text || quantityInfo(offer)?.label || '';
      const brand = offer.products?.brand || '';
      const comparable = groups.get(compareKey(offer)) || [];
      return `<article class="dealCard"><div class="dealMedia">${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.insertAdjacentHTML('afterbegin','<span class=dealPlaceholder>🏷️</span>')">` : '<span class="dealPlaceholder">🏷️</span>'}${discount ? `<span class="discountBadge">−${discount} %</span>` : ''}${isUpcoming(offer) ? `<span class="endingBadge">Platí od ${date(offer.valid_from)}</span>` : offer.valid_to === TODAY ? '<span class="endingBadge">Končí dnes</span>' : ''}<button class="dealMenu" data-report-id="${esc(offer.id)}" title="Nahlásit problém">⋯</button><button class="saveOffer ${saved ? 'active' : ''}" data-save-id="${esc(offer.id)}" aria-label="${saved ? 'Odebrat z uložených' : 'Uložit nabídku'}">${saved ? '♥' : '♡'}</button></div><div class="dealBody"><div class="storeLine">${logoHTML(storeData)}<span>${esc(offer.stores?.name || 'Obchod')}</span></div><h3>${esc(offer.title || offer.products?.name || 'Produkt')}</h3><div class="productDetail">${esc([brand,quantity].filter(Boolean).join(' · ') || offer.categories?.name || '')}</div><div class="priceRow"><span class="price">${money(offer.price)} Kč</span>${oldPriceOf(offer) ? `<span class="oldPrice">${money(offer.old_price)} Kč</span>` : ''}</div>${unitPrice(offer) ? `<div class="unitPrice">${unitPrice(offer)}</div>` : ''}${saving ? `<span class="saving">Ušetříš ${money(saving)} Kč</span>` : ''}<div class="dealActions"><button class="compareButton" data-compare-id="${esc(offer.id)}" ${comparable.length < 2 ? 'disabled' : ''}>${comparable.length > 1 ? `Porovnat (${comparable.length})` : 'Bez porovnání'}</button><a class="storeButton" href="${encodeURIComponent(offer.stores?.slug || '')}.html">Stránka obchodu</a></div><div class="validity">Platí ${date(offer.valid_from)}–${date(offer.valid_to)}</div>${leafletLocation(offer) ? `<a class="leafletLocationButton" href="${esc(leafletLocation(offer).url)}" target="_blank" rel="noopener noreferrer" aria-label="Ukázat produkt v letáku na straně ${leafletLocation(offer).page}"><span>📄</span> Leták · strana ${leafletLocation(offer).page}</a>` : ''}<div class="sourceLine">Zdroj: nabídka obchodu · aktualizováno průběžně</div></div></article>`;
    }).join('');
  }

  function renderAll() {
    renderRegions(); renderCategories(); renderStores(); renderLeaflets(); renderDeals();
    document.querySelectorAll('.quickTab').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  }

  function applySearch(value) {
    state.query = String(value || '').trim(); state.visible = PAGE_SIZE;
    $('q').value = state.query; $('sideSearch').value = state.query;
    saveRecent(state.query); $('searchSuggestions').hidden = true;
    renderDeals(); $('dealsSection').scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function resetFilters() {
    Object.assign(state, { query:'', store:'all', category:'all', region:'all', city:'all', minPrice:null, maxPrice:null, onlyImages:false, savedOnly:false, visible:PAGE_SIZE });
    $('q').value = ''; $('sideSearch').value = ''; $('storeSelect').value = 'all'; $('categorySelect').value = 'all'; $('regionSelect').value = 'all';
    $('minPrice').value = ''; $('maxPrice').value = ''; $('onlyImages').checked = false;
    renderAll();
  }

  function clearFilter(key) {
    if (key === 'all') return resetFilters();
    if (key === 'query') { state.query = ''; $('q').value = ''; $('sideSearch').value = ''; }
    if (key === 'store') state.store = 'all';
    if (key === 'category') state.category = 'all';
    if (key === 'region') { state.region = 'all'; state.city = 'all'; }
    if (key === 'city') state.city = 'all';
    if (key === 'minPrice') { state.minPrice = null; $('minPrice').value = ''; }
    if (key === 'maxPrice') { state.maxPrice = null; $('maxPrice').value = ''; }
    if (key === 'images') { state.onlyImages = false; $('onlyImages').checked = false; }
    if (key === 'saved') state.savedOnly = false;
    state.visible = PAGE_SIZE; renderAll();
  }

  function toggleSaved(id) {
    const key = String(id);
    state.saved.has(key) ? state.saved.delete(key) : state.saved.add(key);
    persistSaved(); renderDeals();
  }

  function openCompare(id) {
    const offer = state.offers.find((item) => String(item.id) === String(id));
    if (!offer) return;
    const matches = state.offers.filter((item) => compareKey(item) === compareKey(offer) && geographyMatches(item)).sort((a,b) => priceOf(a) - priceOf(b));
    $('compareTitle').textContent = offer.products?.name || offer.title;
    $('compareContent').innerHTML = matches.length > 1 ? `<div class="compareList">${matches.map((item,index) => `<article class="compareRow ${index === 0 ? 'best' : ''}"><div><strong>${esc(item.stores?.name || 'Obchod')}${index === 0 ? ' · nejlevnější' : ''}</strong><small>${esc(item.products?.quantity_text || '')} · platí do ${date(item.valid_to)}</small></div><strong class="price">${money(item.price)} Kč</strong></article>`).join('')}</div>` : '<div class="emptyState"><strong>Další nabídka nebyla nalezena</strong><span>Produkt je nyní dostupný jen v jednom obchodě.</span></div>';
    $('compareModal').hidden = false; document.body.style.overflow = 'hidden';
  }

  function openReport(id = '') {
    state.reportOffer = state.offers.find((item) => String(item.id) === String(id)) || null;
    $('reportProduct').textContent = state.reportOffer ? `${state.reportOffer.title} · ${state.reportOffer.stores?.name || ''} · ${money(state.reportOffer.price)} Kč` : 'Obecné hlášení k webu Slevao.cz';
    $('reportNote').value = ''; $('reportModal').hidden = false; document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    $(id).hidden = true;
    if ([...document.querySelectorAll('.modal')].every((modal) => modal.hidden)) document.body.style.overflow = '';
  }

  function sendReport() {
    const offer = state.reportOffer;
    const subject = encodeURIComponent(`Slevao.cz – ${$('reportType').value}`);
    const body = encodeURIComponent([
      `Typ problému: ${$('reportType').value}`,
      offer ? `Produkt: ${offer.title}` : '',
      offer ? `Obchod: ${offer.stores?.name || ''}` : '',
      offer ? `Cena: ${money(offer.price)} Kč` : '',
      offer ? `ID nabídky: ${offer.id}` : '',
      `Poznámka: ${$('reportNote').value.trim() || 'bez poznámky'}`,
      `Stránka: ${location.href}`
    ].filter(Boolean).join('\n'));
    location.href = `mailto:info@slevao.cz?subject=${subject}&body=${body}`;
    closeModal('reportModal'); toast('Hlášení je připravené v e-mailu.');
  }

  function renderSuggestions() {
    const box = $('searchSuggestions');
    const term = $('q').value.trim();
    let rows = [...state.offers];
    if (term) rows = rows.filter((offer) => fold([offer.title, offer.products?.name, offer.products?.brand, offer.stores?.name].join(' ')).includes(fold(term)));
    rows.sort((a,b) => discountOf(b) - discountOf(a));
    rows = rows.slice(0, 7);
    const recent = readJSON(RECENT_KEY, []);
    if (!rows.length && !recent.length) { box.hidden = true; return; }
    box.innerHTML = (term ? `<div class="suggestHead">Nejlepší shody pro „${esc(term)}“</div>` : '<div class="suggestHead">Doporučené nabídky</div>') + rows.map((offer,index) => `<button class="suggestItem" data-suggest-title="${esc(offer.title)}" data-index="${index}"><span class="suggestThumb">${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="">` : '🏷️'}</span><span><strong>${esc(offer.title)}</strong><small>${esc(offer.stores?.name || '')}</small></span><span class="suggestPrice">${money(offer.price)} Kč</span></button>`).join('') + (!term && recent.length ? `<div class="suggestHead">Poslední hledání</div>${recent.map((item) => `<button class="suggestItem" data-suggest-title="${esc(item)}"><span class="suggestThumb">⌕</span><span><strong>${esc(item)}</strong><small>Hledat znovu</small></span></button>`).join('')}` : '');
    box.hidden = false;
  }

  function scrollToDealsAfterStoreLayout() {
    const target = $('dealsSection');
    if (!target) return;

    const storesSection = $('storesSection');
    let observer = null;
    let correctionFrame = 0;
    const correctPosition = () => {
      window.cancelAnimationFrame(correctionFrame);
      correctionFrame = window.requestAnimationFrame(() => {
        target.scrollIntoView({ behavior:'auto', block:'start' });
      });
    };

    if ('ResizeObserver' in window && storesSection) {
      observer = new ResizeObserver(correctPosition);
      observer.observe(storesSection);
      window.setTimeout(() => observer?.disconnect(), 700);
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    });
    window.setTimeout(correctPosition, 80);
    window.setTimeout(correctPosition, 180);
  }

  function bindEvents() {
    $('searchButton').addEventListener('click', () => applySearch($('q').value));
    $('q').addEventListener('keydown', (event) => { if (event.key === 'Enter') applySearch(event.target.value); if (event.key === 'Escape') $('searchSuggestions').hidden = true; });
    $('q').addEventListener('focus', renderSuggestions); $('q').addEventListener('input', renderSuggestions);
    $('searchSuggestions').addEventListener('click', (event) => { const button = event.target.closest('[data-suggest-title]'); if (button) applySearch(button.dataset.suggestTitle); });
    document.addEventListener('click', (event) => { if (!event.target.closest('.mainSearch')) $('searchSuggestions').hidden = true; });
    $('sideSearch').addEventListener('input', (event) => { state.query = event.target.value.trim(); $('q').value = state.query; state.visible = PAGE_SIZE; renderDeals(); });
    $('savedButton').addEventListener('click', () => { state.savedOnly = !state.savedOnly; state.visible = PAGE_SIZE; renderDeals(); $('dealsSection').scrollIntoView({ behavior:'smooth' }); });
    $('mobileSaved').addEventListener('click', () => $('savedButton').click());
    $('categoryChips').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; state.category = button.dataset.category; state.visible = PAGE_SIZE; renderCategories(); renderDeals(); $('dealsSection').scrollIntoView({ behavior:'smooth' }); });
    $('clearCategory').addEventListener('click', () => { state.category = 'all'; renderCategories(); renderDeals(); });
    document.addEventListener('click', (event) => {
      const storeButton = event.target.closest('[data-store]');
      if (storeButton) { state.store = storeButton.dataset.store; state.visible = PAGE_SIZE; renderStores(); renderDeals(); scrollToDealsAfterStoreLayout(); }
      const saveButton = event.target.closest('[data-save-id]'); if (saveButton) toggleSaved(saveButton.dataset.saveId);
      const compareButton = event.target.closest('[data-compare-id]'); if (compareButton && !compareButton.disabled) openCompare(compareButton.dataset.compareId);
      const reportButton = event.target.closest('[data-report-id]'); if (reportButton) openReport(reportButton.dataset.reportId);
      const clearButton = event.target.closest('[data-clear]'); if (clearButton) clearFilter(clearButton.dataset.clear);
      const modalClose = event.target.closest('[data-close-modal]'); if (modalClose) closeModal(modalClose.dataset.closeModal);
    });
    $('showAllStores').addEventListener('click', () => { state.storesExpanded = !state.storesExpanded; renderStores(); });
    $('quickTabs').addEventListener('click', (event) => { const button = event.target.closest('[data-mode]'); if (!button) return; state.mode = button.dataset.mode; state.visible = PAGE_SIZE; document.querySelectorAll('.quickTab').forEach((item) => item.classList.toggle('active', item === button)); renderDeals(); });
    $('sortSelect').addEventListener('change', (event) => { state.sort = event.target.value; state.visible = PAGE_SIZE; renderDeals(); });
    $('storeSelect').addEventListener('change', (event) => { state.store = event.target.value; state.visible = PAGE_SIZE; renderStores(); renderDeals(); });
    $('categorySelect').addEventListener('change', (event) => { state.category = event.target.value; state.visible = PAGE_SIZE; renderCategories(); renderDeals(); });
    $('regionSelect').addEventListener('change', (event) => { state.region = event.target.value; state.city = 'all'; renderCities(); renderDeals(); });
    $('citySelect').addEventListener('change', (event) => { state.city = event.target.value; renderDeals(); });
    $('minPrice').addEventListener('input', (event) => { state.minPrice = event.target.value === '' ? null : Number(event.target.value); state.visible = PAGE_SIZE; renderDeals(); });
    $('maxPrice').addEventListener('input', (event) => { state.maxPrice = event.target.value === '' ? null : Number(event.target.value); state.visible = PAGE_SIZE; renderDeals(); });
    document.querySelectorAll('[data-max-price]').forEach((button) => button.addEventListener('click', () => { state.maxPrice = Number(button.dataset.maxPrice); $('maxPrice').value = state.maxPrice; state.visible = PAGE_SIZE; renderDeals(); }));
    $('onlyImages').addEventListener('change', (event) => { state.onlyImages = event.target.checked; state.visible = PAGE_SIZE; renderDeals(); });
    $('resetFilters').addEventListener('click', resetFilters);
    $('loadMore').addEventListener('click', () => { state.visible += PAGE_SIZE; renderDeals(); });
    $('filterToggle').addEventListener('click', () => $('filterPanel').classList.add('open'));
    $('filterClose').addEventListener('click', () => $('filterPanel').classList.remove('open'));
    $('footerReport').addEventListener('click', () => openReport());
    $('sendReport').addEventListener('click', sendReport);
    document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal.id); }));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach((modal) => closeModal(modal.id)); });
  }

  function applyData(stores, offers, status) {
    const activeStores = stores.filter((store) => store.is_active !== false);
    state.stores = activeStores.sort((a,b) => a.name.localeCompare(b.name,'cs'));
    state.offers = deduplicate(offers).filter((offer) => offer.is_verified === true && activeStores.some((store) => store.slug === offer.stores?.slug));
    $('offerCount').textContent = state.offers.length.toLocaleString('cs-CZ');
    const currentCount = state.offers.filter((offer) => !isUpcoming(offer)).length;
    const nextStart = [...new Set(state.offers.filter(isUpcoming).map((offer) => offer.valid_from).filter(Boolean))].sort()[0];
    const mobileStatus = matchMedia('(max-width: 800px)').matches;
    const visibleStatus = mobileStatus
      ? (/obnovuji/i.test(String(status)) ? 'Obnovuji' : /načítám/i.test(String(status)) ? 'Aktualizováno' : String(status).replace(' dnes', ''))
      : status;
    $('statusPill').textContent = !currentCount && state.offers.length && nextStart ? `✓ Nabídky platí od ${date(nextStart)}` : visibleStatus;
    renderAll();
  }

  async function load() {
    const cache = readJSON(CACHE_KEY, null);
    if (cache && Date.now() - cache.savedAt < 6 * 60 * 60 * 1000) applyData(cache.stores || [], cache.offers || [], 'Obnovuji aktuální data…');
    try {
      const [stores, offers] = await Promise.all([
        rest('stores', { select:'id,name,slug,logo_url,primary_color,is_active', is_active:'eq.true', order:'name.asc' }),
        fetchOffers()
      ]);
      writeJSON(CACHE_KEY, { savedAt:Date.now(), stores, offers });
      applyData(stores, offers, '✓ Aktualizováno dnes');
    } catch (error) {
      console.error(error);
      if (cache) { applyData(cache.stores || [], cache.offers || [], 'Zobrazuji poslední dostupná data'); return; }
      $('statusPill').textContent = 'Nabídky se nepodařilo načíst';
      $('dealGrid').innerHTML = `<div class="errorState"><strong>Data se nepodařilo načíst</strong><span>${esc(error.message || 'Zkontroluj připojení a zkus to znovu.')}</span><button class="primaryButton" onclick="location.reload()">Načíst znovu</button></div>`;
    }
  }

  bindEvents(); persistSaved(); load();
})();