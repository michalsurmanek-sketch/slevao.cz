(() => {
  'use strict';

  const config = window.SLEVAO_STORE || {};
  if (config.slug !== 'globus') return;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const OFFICIAL_URL = 'https://www.globus.cz/olomouc/letaky/aktualni';
  const TODAY = new Date().toISOString().slice(0, 10);

  let cachedPreviewUrl = '';
  let cachedSrcdoc = '';
  let loadingPromise = null;
  let applying = false;
  let closedByUser = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  };

  const money = (value) => Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: Number(value) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });

  const shortDate = (value) => {
    if (!value) return '';
    const date = new Date(String(value).slice(0, 10) + 'T12:00:00');
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric', month: 'numeric', year: 'numeric',
    }).format(date);
  };

  function parseNuxtPayload(html) {
    const match = String(html).match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('Globus nevrátil strukturovaná data katalogu.');
    const payload = JSON.parse(match[1]);
    const cache = new Map();
    const resolve = (index) => {
      if (typeof index !== 'number') return index;
      if (index < 0) {
        if (index === -1) return undefined;
        if (index === -2) return Number.NaN;
        if (index === -3) return Infinity;
        if (index === -4) return -Infinity;
        if (index === -5) return -0;
        return null;
      }
      if (cache.has(index)) return cache.get(index);
      const value = payload[index];
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) {
        if (typeof value[0] === 'string' && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(value[0])) {
          return resolve(value[1]);
        }
        if (value[0] === 'Date') return resolve(value[1]);
        const result = [];
        cache.set(index, result);
        value.forEach((item) => result.push(resolve(item)));
        return result;
      }
      const result = {};
      cache.set(index, result);
      Object.entries(value).forEach(([name, item]) => { result[name] = resolve(item); });
      return result;
    };
    return resolve(0);
  }

  function catalogueFromHtml(html) {
    const root = parseNuxtPayload(html);
    const data = root?.data || {};
    const entry = Object.entries(data).find(([name]) => name.startsWith('actionOfferProductListing-'));
    const listing = entry?.[1];
    if (!listing || !Array.isArray(listing.products)) {
      throw new Error('Globus nevrátil produkty aktuálního katalogu.');
    }
    const products = listing.products.filter((product) => {
      const offer = product?.productInHouse;
      const from = String(offer?.priceValidFrom || '').slice(0, 10);
      const to = String(offer?.priceValidTo || '').slice(0, 10);
      return offer?.isActive !== false
        && (!from || from <= TODAY)
        && (!to || to >= TODAY)
        && Number.isFinite(Number(offer?.actualPrice));
    });
    if (!products.length) throw new Error('V katalogu Globus nejsou právě platné produkty.');
    return {
      products: products.slice(0, 24),
      totalCount: Number(listing.totalCount || products.length),
    };
  }

  function productCard(product) {
    const offer = product?.productInHouse || {};
    const regularPrice = Number(offer.actualPrice);
    const originalPrice = Number(offer.originalPrice || product?.calculatedPrice?.normalPrice || 0);
    const bonus = offer.bonusProgramPrice || null;
    const bonusPrice = Number(bonus?.actualPrice || 0);
    const image = safeUrl(product.imgDetail || product.imgThumbnail || product.imgIcon);
    const name = product.name || product.billName || 'Produkt Globus';
    const brand = product.commonBrand?.name || product.brand?.name || '';
    const quantity = product.sellUnitSizeText || offer.comparisonSaleUnitSizeText || '';
    const validFrom = offer.priceValidFrom;
    const validTo = offer.priceValidTo;
    const discount = Number(offer.discountPercentage || 0);

    return `<article class="product">
      <div class="visual">
        ${image ? `<img src="${esc(image)}" alt="${esc(name)}" loading="lazy">` : '<span class="placeholder">%</span>'}
        ${discount > 0 ? `<span class="discount">−${Math.round(discount)} %</span>` : ''}
      </div>
      <div class="content">
        ${brand && brand.toLocaleLowerCase('cs') !== 'normální' ? `<span class="brand">${esc(brand)}</span>` : ''}
        <h2>${esc(name)}</h2>
        ${quantity ? `<p class="quantity">${esc(quantity)}</p>` : ''}
        <div class="prices">
          <strong>${money(regularPrice)} Kč</strong>
          ${originalPrice > regularPrice ? `<s>${money(originalPrice)} Kč</s>` : ''}
        </div>
        ${bonusPrice > 0 && bonusPrice < regularPrice ? `<div class="bonus"><span>Můj Globus</span><b>${money(bonusPrice)} Kč</b></div>` : ''}
        <small>Platí ${esc(shortDate(validFrom))}–${esc(shortDate(validTo))}</small>
      </div>
    </article>`;
  }

  function buildSrcdoc(catalogue) {
    const countText = catalogue.totalCount > catalogue.products.length
      ? `Zobrazeno ${catalogue.products.length} hlavních nabídek z ${catalogue.totalCount}`
      : `${catalogue.products.length} aktuálních nabídek`;
    return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><base target="_blank"><style>
      :root{font-family:Inter,Arial,sans-serif;color:#14201f;background:#f4f8f7;color-scheme:light}
      *{box-sizing:border-box}body{margin:0;padding:18px;background:linear-gradient(180deg,#eef7f5,#fff 240px)}
      .catalogue{max-width:1180px;margin:auto}.head{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:18px;padding:18px 20px;border-radius:20px;background:#fff;box-shadow:0 10px 32px rgba(18,45,42,.09)}
      .head b{display:block;color:#d71920;font-size:13px;letter-spacing:.08em;text-transform:uppercase}.head h1{margin:4px 0;font-size:clamp(25px,4vw,40px)}.head p{margin:0;color:#60716f;font-weight:700}.official{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:14px;background:#d71920;color:#fff;text-decoration:none;font-weight:900;white-space:nowrap}
      .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.product{overflow:hidden;border:1px solid #dbe7e5;border-radius:18px;background:#fff;box-shadow:0 7px 22px rgba(23,45,43,.07)}
      .visual{position:relative;height:190px;display:flex;align-items:center;justify-content:center;padding:16px;background:#fff}.visual img{width:100%;height:100%;object-fit:contain}.placeholder{font-size:64px;font-weight:950;color:#d71920}.discount{position:absolute;left:12px;top:12px;padding:7px 10px;border-radius:10px;background:#d71920;color:#fff;font-weight:950}
      .content{padding:15px;border-top:1px solid #edf2f1}.brand{display:block;margin-bottom:5px;color:#d71920;font-size:11px;font-weight:950;text-transform:uppercase}.content h2{min-height:48px;margin:0;font-size:17px;line-height:1.4}.quantity{margin:5px 0;color:#60716f;font-weight:700}.prices{display:flex;align-items:baseline;gap:9px;margin-top:12px}.prices strong{color:#d71920;font-size:25px}.prices s{color:#7c8987}.bonus{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding:9px 11px;border-radius:11px;background:#ffe500;color:#173620}.bonus span{font-weight:900}.bonus b{font-size:18px}.content small{display:block;margin-top:11px;padding-top:10px;border-top:1px solid #edf2f1;color:#60716f}
      .foot{margin:18px 0 4px;text-align:center;color:#60716f;font-size:13px;font-weight:700}
      @media(max-width:900px){body{padding:12px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.head{align-items:flex-start;flex-direction:column}.official{width:100%}}
      @media(max-width:520px){body{padding:9px}.head{padding:15px;border-radius:15px}.grid{gap:9px}.product{border-radius:14px}.visual{height:145px;padding:10px}.content{padding:11px}.content h2{min-height:44px;font-size:14px}.prices strong{font-size:20px}.bonus{display:block}.bonus b{display:block;margin-top:3px}.content small{font-size:11px}}
    </style></head><body><main class="catalogue"><header class="head"><div><b>Aktuální online katalog</b><h1>Globus</h1><p>${esc(countText)}</p></div><a class="official" href="${esc(OFFICIAL_URL)}">Otevřít celý katalog Globus ↗</a></header><section class="grid">${catalogue.products.map(productCard).join('')}</section><p class="foot">Ceny a dostupnost se mohou lišit podle konkrétního hypermarketu. Zobrazená data pocházejí z oficiálního katalogu Globus.</p></main></body></html>`;
  }

  async function loadCatalogue(previewUrl) {
    if (cachedSrcdoc && cachedPreviewUrl === previewUrl) return cachedSrcdoc;
    if (loadingPromise && cachedPreviewUrl === previewUrl) return loadingPromise;
    cachedPreviewUrl = previewUrl;
    loadingPromise = (async () => {
      const response = await fetch(previewUrl, {
        headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Globus katalog vrátil HTTP ${response.status}.`);
      let html = '';
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      if (type.includes('application/json')) {
        const payload = await response.json();
        const url = safeUrl(payload?.url);
        if (!url) throw new Error(payload?.error || 'Globus katalog nemá platný zdroj.');
        const source = await fetch(url, { cache: 'no-store' });
        if (!source.ok) throw new Error(`Zdroj katalogu vrátil HTTP ${source.status}.`);
        html = await source.text();
      } else {
        html = await response.text();
      }
      cachedSrcdoc = buildSrcdoc(catalogueFromHtml(html));
      return cachedSrcdoc;
    })().finally(() => { loadingPromise = null; });
    return loadingPromise;
  }

  function setViewerLoading(title) {
    const viewer = document.getElementById('leafletViewer');
    const frame = document.getElementById('leafletFrame');
    const status = document.getElementById('leafletViewerStatus');
    if (!viewer || !frame || !status) return null;
    closedByUser = false;
    document.getElementById('leafletViewerTitle').textContent = title || 'Globus – aktuální online katalog';
    viewer.hidden = false;
    frame.hidden = true;
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    status.hidden = false;
    status.className = 'leafletViewerStatus loading';
    status.textContent = 'Načítám aktuální online katalog Globus…';
    if (matchMedia('(max-width: 820px)').matches) document.body.classList.add('leaflet-viewer-open');
    document.querySelector('.leafletViewerHelp')?.replaceChildren(document.createTextNode('Procházej aktuální akční produkty přímo na Slevao.cz.'));
    window.dispatchEvent(new Event('resize'));
    return { viewer, frame, status };
  }

  function applySrcdoc(srcdoc) {
    if (closedByUser) return;
    const frame = document.getElementById('leafletFrame');
    const status = document.getElementById('leafletViewerStatus');
    const viewer = document.getElementById('leafletViewer');
    if (!frame || !status || !viewer || viewer.hidden) return;
    applying = true;
    frame.removeAttribute('src');
    frame.srcdoc = srcdoc;
    frame.hidden = false;
    frame.dataset.globusCatalog = 'ready';
    status.hidden = true;
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      applying = false;
    });
  }

  async function openCatalogue(previewUrl, title) {
    if (!previewUrl) return;
    const view = setViewerLoading(title);
    if (!view) return;
    document.querySelectorAll('#leafletGrid [data-leaflet-preview]').forEach((button) => {
      button.classList.toggle('active', button.dataset.leafletPreview === previewUrl);
    });
    try {
      applySrcdoc(await loadCatalogue(previewUrl));
    } catch (error) {
      if (closedByUser) return;
      view.status.hidden = false;
      view.status.className = 'leafletViewerStatus error';
      view.status.innerHTML = `<strong>Katalog se nepodařilo zobrazit.</strong><span>${esc(error?.message || 'Zkus stránku obnovit.')}</span><a href="${esc(OFFICIAL_URL)}" target="_blank" rel="noopener noreferrer">Otevřít katalog na Globus.cz ↗</a>`;
    }
  }

  function prepareButton(button) {
    if (!button || button.dataset.globusCataloguePrepared === '1') return;
    button.dataset.globusCataloguePrepared = '1';
    button.dataset.leafletTitle = 'Globus – aktuální online katalog';
    const action = button.querySelector('.leafletAction');
    if (action) action.textContent = 'Prohlížet online katalog zde';
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#leafletGrid [data-leaflet-preview]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCatalogue(button.dataset.leafletPreview, button.dataset.leafletTitle);
  }, true);

  window.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('leafletGrid');
    const viewer = document.getElementById('leafletViewer');
    const frame = document.getElementById('leafletFrame');
    if (!grid || !viewer || !frame) return;

    const gridObserver = new MutationObserver(() => {
      const button = grid.querySelector('[data-leaflet-preview]');
      if (!button) return;
      prepareButton(button);
      if (!matchMedia('(max-width: 820px)').matches && !closedByUser) {
        window.setTimeout(() => openCatalogue(button.dataset.leafletPreview, button.dataset.leafletTitle), 30);
      }
    });
    gridObserver.observe(grid, { childList: true, subtree: true });

    const frameObserver = new MutationObserver(() => {
      if (applying || viewer.hidden || closedByUser) return;
      const button = grid.querySelector('[data-leaflet-preview]');
      if (!button) return;
      prepareButton(button);
      if (frame.getAttribute('src') || !frame.getAttribute('srcdoc')) {
        if (cachedSrcdoc && cachedPreviewUrl === button.dataset.leafletPreview) applySrcdoc(cachedSrcdoc);
        else openCatalogue(button.dataset.leafletPreview, button.dataset.leafletTitle);
      }
    });
    frameObserver.observe(frame, { attributes: true, attributeFilter: ['src', 'srcdoc', 'hidden'] });
    frameObserver.observe(viewer, { attributes: true, attributeFilter: ['hidden'] });

    document.getElementById('closeLeafletViewer')?.addEventListener('click', () => {
      closedByUser = true;
      frame.removeAttribute('srcdoc');
      frame.dataset.globusCatalog = '';
    });

    const existing = grid.querySelector('[data-leaflet-preview]');
    if (existing) prepareButton(existing);
  });
})();