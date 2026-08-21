(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (v) => Number(v || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const date = (v) => v ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' }).format(new Date(`${String(v).slice(0,10)}T12:00:00`)) : '–';

  if (!window.supabase?.createClient) {
    const root = $('productContent');
    if (root) root.innerHTML = '<div class="sfCard sfPanel"><h1>Produkt se nepodařilo načíst</h1><p class="sfMuted">Datové připojení se nenačetlo. Obnov stránku.</p><a class="sfButton primary" href="index.html">Zpět na nabídky</a></div>';
    return;
  }

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  function pragueDate(value = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(value);
  }

  function addCalendarDays(dateKey, days) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return String(dateKey || '');
    return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
  }

  const productId = new URLSearchParams(location.search).get('id');
  let product = null;
  let offers = [];
  let history = [];

  const median = (values) => {
    const rows = values.map(Number).filter(Number.isFinite).sort((a,b) => a-b);
    if (!rows.length) return null;
    const mid = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
  };

  const isUpcoming = (offer, today = pragueDate()) => String(offer?.valid_from || '') > today;

  function offerStoreKey(offer) {
    return String(offer?.store_id || '').trim();
  }

  function offerStoreLabel(offer) {
    const storeName = offer?.stores?.name || 'Obchod';
    const storeFormat = String(offer?.store_location_name || '').trim();
    return storeFormat ? `${storeName} · ${storeFormat}` : storeName;
  }

  function offerIdentityKey(offer) {
    return [
      offer?.store_id || '',
      String(offer?.store_location_name || '').trim().toLowerCase(),
      Number(offer?.price || 0).toFixed(4),
      Number(offer?.old_price || 0).toFixed(4),
      Number(offer?.unit_price || 0).toFixed(4),
      String(offer?.unit_price_unit || '').trim().toLowerCase(),
      String(offer?.valid_from || ''),
      String(offer?.valid_to || '')
    ].join('|');
  }

  function dedupeOffers(rows) {
    const unique = new Map();
    for (const row of rows || []) {
      const key = offerIdentityKey(row);
      if (!unique.has(key)) unique.set(key, row);
    }
    return [...unique.values()];
  }

  function storeLogoHtml(store, wrapperClass = 'sfStoreLogo') {
    const slug = String(store?.slug || '').trim();
    const dbLogo = String(store?.logo_url || '').trim();
    const localLogo = slug ? `assets/logos/${encodeURIComponent(slug)}.svg` : '';
    const src = dbLogo || localLogo;
    if (!src) return '';
    return `<span class="${esc(wrapperClass)}"><img src="${esc(src)}"${dbLogo && localLogo ? ` data-logo-fallback="${esc(localLogo)}"` : ''} alt="${esc(store?.name || 'Obchod')}" loading="lazy"></span>`;
  }

  function statWindow(days) {
    const from = Date.now() - days * 86400000;
    const values = history.filter((row) => new Date(row.recorded_at).getTime() >= from).map((row) => Number(row.price));
    return values.length ? Math.min(...values) : null;
  }

  function typicalPrice() {
    const from = Date.now() - 90 * 86400000;
    const values = history.filter((row) => new Date(row.recorded_at).getTime() >= from).map((row) => Number(row.price));
    return median(values.length ? values : offers.map((row) => row.price));
  }

  function dealLabel(offer) {
    const typical = typicalPrice();
    const price = Number(offer.price || 0);
    if (!typical || !price) return { label:'Nabídka obchodu', className:'' };
    const ratio = price / typical;
    if (ratio <= .82) return { label:'Výborná cena', className:'' };
    if (ratio <= .94) return { label:'Dobrá akce', className:'' };
    if (ratio <= 1.06) return { label:'Běžná akční cena', className:'warn' };
    return { label:'Méně výhodná nabídka', className:'warn' };
  }

  function chartSvg() {
    const rows = history.slice().sort((a,b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    if (rows.length < 2) return '<div class="sfEmpty">Historie zatím neobsahuje dostatek měření pro graf.</div>';
    const width = 860, height = 250, pad = 34;
    const prices = rows.map((row) => Number(row.price)).filter(Number.isFinite);
    const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(1, max - min);
    const points = rows.map((row, index) => ({
      x: pad + index * ((width - pad * 2) / Math.max(1, rows.length - 1)),
      y: height - pad - ((Number(row.price) - min) / span) * (height - pad * 2), row
    }));
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vývoj ceny produktu"><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}" stroke="#dbe8e5"/><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="#dbe8e5"/><path d="${path}" fill="none" stroke="#0b776f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#12b8a6"><title>${money(point.row.price)} Kč · ${date(point.row.recorded_at)}</title></circle>`).join('')}<text x="6" y="${pad+4}" font-size="13" fill="#667774">${money(max)} Kč</text><text x="6" y="${height-pad+4}" font-size="13" fill="#667774">${money(min)} Kč</text><text x="${pad}" y="${height-7}" font-size="12" fill="#667774">${date(rows[0].recorded_at)}</text><text x="${width-pad}" y="${height-7}" text-anchor="end" font-size="12" fill="#667774">${date(rows.at(-1).recorded_at)}</text></svg>`;
  }

  function offerHtml(offer, isBest, today) {
    const label = dealLabel(offer);
    const store = offer.stores;
    const discount = Number(offer.old_price) > Number(offer.price)
      ? Math.round((Number(offer.old_price) - Number(offer.price)) / Number(offer.old_price) * 100) : 0;
    const validity = isUpcoming(offer, today)
      ? `začíná ${date(offer.valid_from)} · platí do ${date(offer.valid_to)}`
      : `platí do ${date(offer.valid_to)}`;
    const bestText = isBest ? (isUpcoming(offer, today) ? ' · nejnižší nadcházející cena' : ' · nejnižší cena dnes') : '';
    return `<article class="sfCard sfOffer ${isBest ? 'best' : ''}">
      <div class="sfOfferStoreRow">${storeLogoHtml(store)}<div class="sfOfferStore">${esc(offerStoreLabel(offer))}${bestText}</div></div>
      <div><span class="sfPrice">${money(offer.price)} Kč</span>${offer.old_price ? `<span class="sfOldPrice">${money(offer.old_price)} Kč</span>` : ''}</div>
      <div class="sfMuted">${offer.unit_price ? `${money(offer.unit_price)} Kč/${esc(offer.unit_price_unit || 'jednotka')} · ` : ''}${validity}</div>
      <div style="margin-top:9px"><span class="sfBadge ${label.className}">${esc(label.label)}</span>${isUpcoming(offer, today) ? ' <span class="sfBadge warn">Od zítřka / brzy</span>' : ''}${discount ? ` <span class="sfBadge">−${discount} %</span>` : ''}</div>
      <div class="sfOfferActions">
        <button class="sfButton primary" type="button" data-add-offer="${offer.id}">Přidat do seznamu</button>
        <button class="sfButton" type="button" data-alert-offer="${offer.id}">Hlídat cenu</button>
        <a class="sfButton" href="${esc(store?.slug || '')}.html">Stránka obchodu</a>
        <button class="sfButton" type="button" data-report-offer="${offer.id}">Nahlásit problém</button>
      </div>
    </article>`;
  }

  function renderIdentity() {
    if (!product) return;
    document.title = `${product.name} – ceny a historie | Slevao.cz`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', `Porovnání aktuálních a nadcházejících cen produktu ${product.name}, historie cen a cenový hlídač.`);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://slevao.cz/produkt.html?id=${encodeURIComponent(product.id)}`);
    $('productName').textContent = product.name;
    $('productMeta').textContent = [product.brand, product.quantity_text, product.ean ? `EAN ${product.ean}` : ''].filter(Boolean).join(' · ');
    $('productImage').innerHTML = product.image_url ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}">` : '<div class="sfEmpty">Fotografie zatím není ověřena.</div>';
  }

  function renderOffers() {
    const today = pragueDate();
    const visible = dedupeOffers(offers).sort((a,b) => Number(isUpcoming(a, today)) - Number(isUpcoming(b, today)) || Number(a.price) - Number(b.price));
    const current = visible.filter((row) => !isUpcoming(row, today));
    const comparable = current.length ? current : visible;
    const cheapest = comparable.slice().sort((a,b) => Number(a.price) - Number(b.price))[0] || null;
    $('currentPrice').textContent = cheapest ? `${money(cheapest.price)} Kč` : 'Bez viditelné ceny';
    $('currentStore').innerHTML = cheapest
      ? `<span class="sfCurrentStore">${storeLogoHtml(cheapest.stores, 'sfCurrentStoreLogo')}<span>${esc(isUpcoming(cheapest, today) ? `Od ${date(cheapest.valid_from)} nejlevněji v ${offerStoreLabel(cheapest)}` : `Právě teď nejlevněji v ${offerStoreLabel(cheapest)}`)}</span></span>`
      : 'Aktuální ani nadcházející nabídka není dostupná';
    $('statStores').textContent = String(new Set(visible.map(offerStoreKey).filter(Boolean)).size);
    $('statTypical').textContent = typicalPrice() == null ? '–' : `${money(typicalPrice())} Kč`;
    $('offers').innerHTML = visible.length ? visible.map((offer) => offerHtml(offer, cheapest && String(offer.id) === String(cheapest.id), today)).join('') : '<div class="sfEmpty">Tento produkt nemá platnou ani brzy začínající akční nabídku.</div>';
    $('offers').dataset.loaded = '1';
    window.dispatchEvent(new CustomEvent('slevao:product-offers-rendered', { detail:{ productId, offerCount:visible.length } }));
  }

  function renderHistory() {
    $('stat30').textContent = statWindow(30) == null ? '–' : `${money(statWindow(30))} Kč`;
    $('stat90').textContent = statWindow(90) == null ? '–' : `${money(statWindow(90))} Kč`;
    $('statTypical').textContent = typicalPrice() == null ? '–' : `${money(typicalPrice())} Kč`;
    $('priceChart').innerHTML = chartSvg();
    $('historyInfo').textContent = history.length ? `${history.length} cenových záznamů · poslední kontrola ${date(history.at(-1)?.recorded_at)}` : 'Historie cen zatím není dostupná.';
  }

  function openModal(title, eyebrow = 'Slevao.cz') {
    const modal = document.createElement('div');
    modal.className = 'sfModal';
    modal.innerHTML = `<div class="sfModalBox" role="dialog" aria-modal="true" aria-labelledby="sfDetailModalTitle"><div class="sfModalHead"><div><small>${esc(eyebrow)}</small><h2 id="sfDetailModalTitle">${esc(title)}</h2></div><button class="sfModalClose" type="button" aria-label="Zavřít">×</button></div><div class="sfModalBody"></div></div>`;
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      modal.remove();
    };
    const onKeydown = (event) => { if (event.key === 'Escape') close(); };
    modal.querySelector('.sfModalClose').addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(modal);
    window.setTimeout(() => modal.querySelector('input,select,textarea,button')?.focus(), 0);
    return { modal, body:modal.querySelector('.sfModalBody'), close };
  }

  function withTimeout(request, label, ms = 8000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} se nepodařilo načíst včas.`)), ms);
    });
    return Promise.race([Promise.resolve(request), timeout]).finally(() => window.clearTimeout(timer));
  }

  async function load() {
    if (!productId) throw new Error('V odkazu chybí identifikátor produktu.');

    const today = pragueDate();
    const upcomingTo = addCalendarDays(today, 7);
    const productRequest = withTimeout(
      db.from('products').select('id,name,slug,brand,ean,quantity_text,image_url,description,category_id').eq('id', productId).maybeSingle(),
      'Produkt'
    );
    const offersRequest = withTimeout(
      db.from('offers').select('id,product_id,store_id,title,price,old_price,unit_price,unit_price_unit,valid_from,valid_to,source_url,store_location_name,metadata,stores(id,name,slug,logo_url)').eq('product_id', productId).eq('status','published').lte('valid_from', upcomingTo).gte('valid_to', today).limit(100),
      'Aktuální nabídky'
    );
    window.__slevaoProductOffersPromise = Promise.resolve(offersRequest).then(
      (result) => ({ rows: result?.error ? [] : (result?.data || []), error: result?.error || null }),
      (error) => ({ rows: [], error })
    );

    const productResult = await productRequest;
    if (productResult.error) throw productResult.error;
    if (!productResult.data) throw new Error('Produkt nebyl nalezen.');
    product = productResult.data;
    renderIdentity();

    const sharedOffers = await window.__slevaoProductOffersPromise;
    offers = sharedOffers?.error ? [] : (sharedOffers?.rows || []);
    renderOffers();

    const historyRequest = withTimeout(
      db.from('price_history').select('id,product_id,store_id,offer_id,price,old_price,unit_price,recorded_at,valid_from,valid_to,stores(name,slug,logo_url)').eq('product_id', productId).order('recorded_at').limit(1000),
      'Historie cen',
      10000
    );
    const historyResult = await historyRequest.catch((error) => ({ data:[], error }));
    if (!historyResult.error) history = historyResult.data || [];
    renderHistory();
    renderOffers();
  }

  function createAlert(offer) {
    const storeName = offerStoreLabel(offer);
    const suggested = Math.max(1, Math.floor(Number(offer.price || 0) * .9));
    const { body, close } = openModal('Hlídat cenu produktu', 'Cenový hlídač');
    body.innerHTML = `<p><strong>${esc(product.name)}</strong></p><p class="sfMuted">Aktuální cena této nabídky: ${money(offer.price)} Kč · ${esc(storeName)}</p><label>Upozorni mě při ceně nejvýše<input id="sfDetailTargetPrice" type="number" min="0.01" step="0.1" inputmode="decimal" value="${suggested}"></label><label><span><input id="sfDetailOnlyStore" type="checkbox" style="width:auto;margin-right:8px">Pouze v tomto obchodě</span></label><div class="sfModalActions"><button class="sfButton" type="button" data-cancel>Zrušit</button><button class="sfButton primary" type="button" data-save>Zapnout hlídač</button></div>`;
    body.querySelector('[data-cancel]').addEventListener('click', close);
    body.querySelector('[data-save]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const target = Number(String(body.querySelector('#sfDetailTargetPrice')?.value || '').replace(',', '.'));
      if (!(target > 0)) { window.SlevaoPublic?.toast('Zadej platnou cílovou cenu.'); return; }
      button.disabled = true;
      try {
        const onlyStore = Boolean(body.querySelector('#sfDetailOnlyStore')?.checked);
        const storeId = onlyStore ? offer.store_id : null;
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
          localStorage.setItem(PENDING_ALERT_KEY, JSON.stringify({ product_id:product.id, search_term:product.name, target_price:target, store_id:storeId, return_url:location.href }));
          location.href = `ucet.html?redirect=${encodeURIComponent(location.href)}`;
          return;
        }
        const { error } = await db.from('price_alerts').insert({ user_id:session.user.id, product_id:product.id, search_term:product.name, target_price:target, store_id:storeId, is_active:true });
        if (error) throw error;
        close();
        window.SlevaoPublic?.toast(`Hlídač ceny do ${money(target)} Kč je aktivní.`);
      } catch (error) {
        button.disabled = false;
        window.SlevaoPublic?.toast(error.message || 'Hlídač se nepodařilo vytvořit.');
      }
    });
  }

  function reportOffer(offer) {
    const { body, close } = openModal('Nahlásit problém s nabídkou', 'Kontrola nabídky');
    body.innerHTML = `<p><strong>${esc(product.name)}</strong></p><p class="sfMuted">${esc(offerStoreLabel(offer))} · ${money(offer.price)} Kč</p><label>Typ problému<select id="sfDetailReportType"><option value="wrong_price">Cena neplatí</option><option value="wrong_image">Špatná fotografie</option><option value="wrong_quantity">Nesprávná gramáž</option><option value="expired">Akce skončila</option><option value="unavailable">Produkt není dostupný</option><option value="other">Jiný problém</option></select></label><label>Poznámka<textarea id="sfDetailReportNote" rows="4" maxlength="2000" placeholder="Krátce popiš, co nesedí…"></textarea></label><div class="sfModalActions"><button class="sfButton" type="button" data-cancel>Zrušit</button><button class="sfButton primary" type="button" data-save>Odeslat hlášení</button></div>`;
    body.querySelector('[data-cancel]').addEventListener('click', close);
    body.querySelector('[data-save]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const reportType = body.querySelector('#sfDetailReportType')?.value || 'other';
        const note = String(body.querySelector('#sfDetailReportNote')?.value || '').slice(0,2000);
        const { data: { session } } = await db.auth.getSession();
        const { error } = await db.from('offer_reports').insert({
          offer_id:offer.id,
          product_id:product.id,
          user_id:session?.user?.id || null,
          report_type:reportType,
          note,
          page_url:location.href,
          status:'new'
        });
        if (error) throw error;
        close();
        window.SlevaoPublic?.toast('Děkujeme. Hlášení bylo uloženo ke kontrole.');
      } catch (error) {
        button.disabled = false;
        window.SlevaoPublic?.toast(error.message || 'Hlášení se nepodařilo uložit.');
      }
    });
  }

  document.addEventListener('error', (event) => {
    const image = event.target.closest?.('img[data-logo-fallback]');
    if (!image) return;
    const fallback = image.dataset.logoFallback;
    delete image.dataset.logoFallback;
    if (fallback) image.src = fallback;
  }, true);

  document.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add-offer]');
    const alert = event.target.closest('[data-alert-offer]');
    const report = event.target.closest('[data-report-offer]');
    const id = add?.dataset.addOffer || alert?.dataset.alertOffer || report?.dataset.reportOffer;
    if (!id) return;
    const offer = offers.find((row) => row.id === id);
    if (!offer) return;
    try {
      if (add) { window.SlevaoPublic?.addItemFromOffer({ ...offer, products:product }); window.SlevaoPublic?.toast('Produkt byl přidán do seznamu.'); }
      if (alert) createAlert(offer);
      if (report) reportOffer(offer);
    } catch (error) { window.SlevaoPublic?.toast(error.message || 'Akci se nepodařilo dokončit.'); }
  });

  load().catch((error) => {
    const root = $('productContent');
    if (root) root.innerHTML = `<div class="sfCard sfPanel"><h1>Produkt se nepodařilo načíst</h1><p class="sfMuted">${esc(error.message)}</p><a class="sfButton primary" href="index.html">Zpět na nabídky</a></div>`;
  });
})();