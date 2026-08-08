(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const money = (v) => Number(v || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const date = (v) => v ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' }).format(new Date(`${String(v).slice(0,10)}T12:00:00`)) : '–';

  function pragueDate(offsetDays = 0) {
    const target = new Date(Date.now() + offsetDays * 86400000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(target);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  const today = pragueDate(0);
  const upcomingTo = pragueDate(7);
  const productId = new URLSearchParams(location.search).get('id');
  let product = null;
  let offers = [];
  let history = [];
  let leafletLocations = [];

  const median = (values) => {
    const rows = values.map(Number).filter(Number.isFinite).sort((a,b) => a-b);
    if (!rows.length) return null;
    const mid = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
  };

  const isUpcoming = (offer) => String(offer?.valid_from || '') > today;

  function offerStoreKey(offer) {
    return `${offer?.store_id || ''}|${String(offer?.store_location_name || '').trim().toLowerCase()}`;
  }

  function offerStoreLabel(offer) {
    const storeName = offer?.stores?.name || 'Obchod';
    const storeFormat = String(offer?.store_location_name || '').trim();
    return storeFormat ? `${storeName} · ${storeFormat}` : storeName;
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

  function matchingLeaflet(offer) {
    return leafletLocations.find((row) => row.store_id === offer.store_id && (!row.valid_from || row.valid_from === offer.valid_from))
      || leafletLocations.find((row) => row.store_id === offer.store_id)
      || null;
  }

  function offerHtml(offer, index) {
    const label = dealLabel(offer);
    const store = offer.stores;
    const discount = Number(offer.old_price) > Number(offer.price)
      ? Math.round((Number(offer.old_price) - Number(offer.price)) / Number(offer.old_price) * 100) : 0;
    const location = matchingLeaflet(offer);
    const leafletUrl = location?.document_url ? `${location.document_url}#page=${Math.max(1, Number(location.source_page || 1))}` : null;
    const validity = isUpcoming(offer)
      ? `začíná ${date(offer.valid_from)} · platí do ${date(offer.valid_to)}`
      : `platí do ${date(offer.valid_to)}`;
    return `<article class="sfCard sfOffer ${index === 0 ? 'best' : ''}">
      <div class="sfOfferStore">${esc(offerStoreLabel(offer))}${index === 0 ? ' · nejnižší cena' : ''}</div>
      <div><span class="sfPrice">${money(offer.price)} Kč</span>${offer.old_price ? `<span class="sfOldPrice">${money(offer.old_price)} Kč</span>` : ''}</div>
      <div class="sfMuted">${offer.unit_price ? `${money(offer.unit_price)} Kč/${esc(offer.unit_price_unit || 'jednotka')} · ` : ''}${validity}</div>
      <div style="margin-top:9px"><span class="sfBadge ${label.className}">${esc(label.label)}</span>${isUpcoming(offer) ? ' <span class="sfBadge warn">Od zítřka / brzy</span>' : ''}${discount ? ` <span class="sfBadge">−${discount} %</span>` : ''}</div>
      <div class="sfOfferActions">
        <button class="sfButton primary" type="button" data-add-offer="${offer.id}">Přidat do seznamu</button>
        <button class="sfButton" type="button" data-alert-offer="${offer.id}">Hlídat cenu</button>
        ${leafletUrl ? `<a class="sfButton" href="${esc(leafletUrl)}" target="_blank" rel="noopener">Leták · strana ${location.source_page}</a>` : `<a class="sfButton" href="${esc(store?.slug || '')}.html">Stránka obchodu</a>`}
        <button class="sfButton" type="button" data-report-offer="${offer.id}">Nahlásit problém</button>
      </div>
    </article>`;
  }

  function render() {
    const visible = offers.slice().sort((a,b) => Number(isUpcoming(a)) - Number(isUpcoming(b)) || Number(a.price) - Number(b.price));
    const cheapest = visible.slice().sort((a,b) => Number(a.price) - Number(b.price))[0];
    const typical = typicalPrice();
    document.title = `${product.name} – ceny a historie | Slevao.cz`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', `Porovnání aktuálních a nadcházejících cen produktu ${product.name}, historie cen a cenový hlídač.`);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://slevao.cz/produkt.html?id=${encodeURIComponent(product.id)}`);
    $('productName').textContent = product.name;
    $('productMeta').textContent = [product.brand, product.quantity_text, product.ean ? `EAN ${product.ean}` : ''].filter(Boolean).join(' · ');
    $('productImage').innerHTML = product.image_url ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}">` : '<div class="sfEmpty">Fotografie zatím není ověřena.</div>';
    $('currentPrice').textContent = cheapest ? `${money(cheapest.price)} Kč` : 'Bez viditelné ceny';
    $('currentStore').textContent = cheapest
      ? `${isUpcoming(cheapest) ? `Od ${date(cheapest.valid_from)}` : 'Právě teď'} nejlevněji v ${offerStoreLabel(cheapest)}`
      : 'Aktuální ani nadcházející nabídka není dostupná';
    $('stat30').textContent = statWindow(30) == null ? '–' : `${money(statWindow(30))} Kč`;
    $('stat90').textContent = statWindow(90) == null ? '–' : `${money(statWindow(90))} Kč`;
    $('statTypical').textContent = typical == null ? '–' : `${money(typical)} Kč`;
    $('statStores').textContent = String(new Set(visible.map(offerStoreKey)).size);
    $('offers').innerHTML = visible.length ? visible.map(offerHtml).join('') : '<div class="sfEmpty">Tento produkt nemá platnou ani brzy začínající akční nabídku.</div>';
    $('priceChart').innerHTML = chartSvg();
    $('historyInfo').textContent = history.length ? `${history.length} cenových záznamů · poslední kontrola ${date(history.at(-1)?.recorded_at)}` : 'Historie cen zatím není dostupná.';
  }

  async function load() {
    if (!productId) throw new Error('V odkazu chybí identifikátor produktu.');
    const [productResult, offersResult, historyResult, locationResult] = await Promise.all([
      db.from('products').select('id,name,slug,brand,ean,quantity_text,image_url,description,category_id').eq('id', productId).maybeSingle(),
      db.from('offers').select('id,product_id,store_id,title,price,old_price,unit_price,unit_price_unit,valid_from,valid_to,source_url,store_location_name,stores(id,name,slug)').eq('product_id', productId).eq('status','published').lte('valid_from', upcomingTo).gte('valid_to', today).limit(100),
      db.from('price_history').select('id,product_id,store_id,offer_id,price,old_price,unit_price,recorded_at,valid_from,valid_to,stores(name,slug)').eq('product_id', productId).order('recorded_at').limit(1000),
      db.from('public_product_leaflet_locations').select('*').eq('product_id', productId).order('valid_to', { ascending:false }).limit(30)
    ]);
    if (productResult.error) throw productResult.error;
    if (!productResult.data) throw new Error('Produkt nebyl nalezen.');
    if (offersResult.error) throw offersResult.error;
    if (historyResult.error) throw historyResult.error;
    product = productResult.data;
    offers = offersResult.data || [];
    history = historyResult.data || [];
    leafletLocations = locationResult.error ? [] : (locationResult.data || []);
    render();
  }

  async function createAlert(offer) {
    const targetInput = prompt(`Upozornit, až bude ${product.name} nejvýše za kolik Kč?`, String(Math.max(1, Math.floor(Number(offer.price || 0) * .9))));
    if (targetInput == null) return;
    const target = Number(String(targetInput).replace(',', '.'));
    if (!(target > 0)) { window.SlevaoPublic?.toast('Zadej platnou cílovou cenu.'); return; }
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      localStorage.setItem(PENDING_ALERT_KEY, JSON.stringify({ product_id: product.id, search_term: product.name, target_price: target, store_id: null, return_url: location.href }));
      location.href = `ucet.html?redirect=${encodeURIComponent(location.href)}`;
      return;
    }
    const { error } = await db.from('price_alerts').insert({ user_id:session.user.id, product_id:product.id, search_term:product.name, target_price:target, is_active:true });
    if (error) throw error;
    window.SlevaoPublic?.toast(`Hlídač ceny do ${money(target)} Kč je aktivní.`);
  }

  async function reportOffer(offer) {
    const type = prompt('Napiš typ problému: cena, obrázek, gramáž, skončená akce, nedostupnost nebo jiný problém.', 'cena');
    if (type == null) return;
    const map = { cena:'wrong_price', obrázek:'wrong_image', obrazek:'wrong_image', gramáž:'wrong_quantity', gramaz:'wrong_quantity', 'skončená akce':'expired', 'skoncena akce':'expired', nedostupnost:'unavailable' };
    const note = prompt('Doplň krátkou poznámku.', '') ?? '';
    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from('offer_reports').insert({
      offer_id:offer.id, product_id:product.id, user_id:session?.user?.id || null,
      report_type:map[type.trim().toLowerCase()] || 'other', note:note.slice(0,2000), page_url:location.href, status:'new'
    });
    if (error) throw error;
    window.SlevaoPublic?.toast('Děkujeme. Hlášení bylo uloženo ke kontrole.');
  }

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
      if (alert) await createAlert(offer);
      if (report) await reportOffer(offer);
    } catch (error) { window.SlevaoPublic?.toast(error.message || 'Akci se nepodařilo dokončit.'); }
  });

  load().catch((error) => {
    $('productContent').innerHTML = `<div class="sfCard sfPanel"><h1>Produkt se nepodařilo načíst</h1><p class="sfMuted">${esc(error.message)}</p><a class="sfButton primary" href="index.html">Zpět na nabídky</a></div>`;
  });
})();