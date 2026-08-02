(() => {
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const OFFICIAL_URL = 'https://www.action.com/cs-cz/tydenni-akce/';
  const grid = document.getElementById('leafletGrid');
  const viewer = document.getElementById('leafletViewer');
  const frame = document.getElementById('leafletFrame');
  const status = document.getElementById('leafletViewerStatus');
  const title = document.getElementById('leafletViewerTitle');
  const closeButton = document.getElementById('closeLeafletViewer');
  if (!grid || !viewer || !frame || !status || !title) return;

  let objectUrl = '';
  let controller = null;
  let autoOpened = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: Number(value || 0) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : '';

  async function request(table, params, signal) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error(`Databáze odpověděla chybou ${response.status}.`);
    return response.json();
  }

  function uniqueOffers(rows) {
    const seen = new Set();
    return rows.filter((offer) => {
      const key = `${String(offer.title || '').trim().toLowerCase()}|${Number(offer.price || 0)}|${offer.valid_from}|${offer.valid_to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function loadActionData(signal) {
    const stores = await request('stores', {
      select: 'id,name,logo_url,primary_color,is_active',
      slug: 'eq.action',
      is_active: 'eq.true',
      limit: '1',
    }, signal);
    const store = stores[0];
    if (!store) throw new Error('Action je v administraci skrytý nebo chybí v databázi.');

    const today = new Date().toISOString().slice(0, 10);
    const offers = await request('offers', {
      select: 'id,title,price,old_price,image_url,valid_from,valid_to,published_at',
      store_id: `eq.${store.id}`,
      status: 'eq.published',
      valid_from: `lte.${today}`,
      valid_to: `gte.${today}`,
      order: 'published_at.desc',
      limit: '120',
    }, signal);
    return { store, offers: uniqueOffers(offers) };
  }

  function productCard(offer) {
    const price = Number(offer.price || 0);
    const oldPrice = Number(offer.old_price || 0);
    const discount = oldPrice > price ? Math.round((oldPrice - price) / oldPrice * 100) : 0;
    return `<article class="product">
      <div class="photo">
        ${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.classList.add('empty')">` : ''}
        ${discount ? `<span class="discount">−${discount} %</span>` : ''}
      </div>
      <div class="productBody">
        <h2>${esc(offer.title)}</h2>
        <div class="prices"><strong>${money(price)} Kč</strong>${oldPrice > price ? `<s>${money(oldPrice)} Kč</s>` : ''}</div>
        <span class="weekly">TÝDENNÍ AKCE</span>
      </div>
    </article>`;
  }

  function buildLeafletDocument(store, offers) {
    const pageSize = 8;
    const fallbackFrom = offers.map((offer) => offer.valid_from).filter(Boolean).sort()[0] || '';
    const fallbackTo = offers.map((offer) => offer.valid_to).filter(Boolean).sort().at(-1) || '';
    const pages = [];
    for (let index = 0; index < offers.length; index += pageSize) pages.push(offers.slice(index, index + pageSize));
    if (!pages.length) pages.push([]);
    const primary = /^#[0-9a-f]{6}$/i.test(store.primary_color || '') ? store.primary_color : '#0050aa';
    const logo = String(store.logo_url || '');

    const pageMarkup = pages.map((page, pageIndex) => `<section class="sheet${pageIndex === 0 ? ' active' : ''}" data-page="${pageIndex}">
      <header class="sheetHead">
        <div class="brand">${logo ? `<img src="${esc(logo)}" alt="Action" referrerpolicy="no-referrer">` : '<strong>ACTION</strong>'}</div>
        <div><span>AKTUÁLNÍ LETÁK</span><h1>Týdenní akce</h1><p>${fallbackFrom && fallbackTo ? `${formatDate(fallbackFrom)} – ${formatDate(fallbackTo)}` : 'Aktuální nabídka'}</p></div>
      </header>
      ${page.length ? `<div class="products">${page.map(productCard).join('')}</div>` : `<div class="emptyState"><strong>Aktuální produkty se právě načítají.</strong><p>Kompletní týdenní akci najdeš na oficiálním webu Action.</p><a href="${OFFICIAL_URL}" target="_blank" rel="noopener">Otevřít Action</a></div>`}
      <footer><span>Nízké ceny. Velké úsměvy.</span><b>${pageIndex + 1}</b></footer>
    </section>`).join('');

    return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3"><title>Action – týdenní akce</title>
<style>
:root{--action:${primary};--yellow:#ffdd00;--zoom:1}*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif;background:#2f3133;color:#10212d}body{overflow-x:hidden}.viewerBar{position:sticky;top:0;z-index:20;min-height:58px;background:#363636;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px;box-shadow:0 2px 10px #0005}.viewerBar .group{display:flex;align-items:center;gap:7px}.viewerBar button,.viewerBar a{min-width:38px;height:38px;border:0;border-radius:8px;background:#242424;color:#fff;display:grid;place-items:center;text-decoration:none;font-weight:800;cursor:pointer;padding:0 12px}.viewerBar button:hover,.viewerBar a:hover{background:#111}.viewerBar .count{min-width:80px;text-align:center;font-weight:800}.stage{padding:18px 12px 40px;overflow:auto}.sheet{display:none;width:min(920px,100%);min-height:1180px;margin:0 auto;background:#fff;box-shadow:0 10px 35px #0008;transform:scale(var(--zoom));transform-origin:top center;border-radius:3px;overflow:hidden}.sheet.active{display:block}.sheetHead{display:grid;grid-template-columns:190px 1fr;align-items:center;gap:24px;padding:30px 34px;background:linear-gradient(135deg,var(--yellow) 0 58%,var(--action) 58%);color:#082f66}.sheetHead .brand{height:110px;display:grid;place-items:center;background:#fff;border-radius:20px;padding:14px}.sheetHead img{max-width:100%;max-height:82px}.sheetHead .brand strong{font-size:30px;color:var(--action)}.sheetHead span{font-weight:900;letter-spacing:.12em;font-size:13px}.sheetHead h1{margin:5px 0 3px;font-size:45px;line-height:1}.sheetHead p{margin:0;font-size:18px;font-weight:700}.products{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:24px}.product{display:grid;grid-template-columns:45% 1fr;min-height:220px;border:2px solid #dfe8ed;border-radius:18px;overflow:hidden;background:#fff;position:relative}.photo{position:relative;min-height:210px;background:#f5f7f8;display:grid;place-items:center;overflow:hidden}.photo.empty:after,.photo:not(:has(img)):after{content:'ACTION';font-size:22px;font-weight:900;color:#b4c0c7}.photo img{width:100%;height:100%;object-fit:contain;padding:10px}.discount{position:absolute;top:10px;left:10px;background:#e4212b;color:#fff;border-radius:999px;padding:8px 10px;font-weight:900}.productBody{padding:20px 17px 16px;display:flex;flex-direction:column}.product h2{font-size:20px;line-height:1.15;margin:0 0 14px}.prices{margin-top:auto;display:flex;align-items:end;gap:9px;flex-wrap:wrap}.prices strong{font-size:31px;color:#e4212b;line-height:1}.prices s{color:#65747c;font-weight:700}.weekly{margin-top:12px;color:var(--action);font-size:11px;font-weight:900;letter-spacing:.08em}.sheet footer{display:flex;justify-content:space-between;align-items:center;margin:0 24px 22px;padding:14px 18px;background:var(--action);color:#fff;border-radius:12px;font-weight:900}.emptyState{min-height:850px;display:grid;place-content:center;text-align:center;padding:30px}.emptyState strong{font-size:30px}.emptyState a{display:inline-grid;place-items:center;height:48px;margin:16px auto 0;padding:0 20px;background:var(--action);color:#fff;border-radius:12px;text-decoration:none;font-weight:900}
@media(max-width:650px){.viewerBar{padding:7px 8px}.viewerBar button,.viewerBar a{min-width:34px;height:36px;padding:0 9px}.viewerBar .desktopOnly{display:none}.stage{padding:8px 0 24px}.sheet{width:100%;min-height:calc(100vh - 58px);box-shadow:none;border-radius:0}.sheetHead{grid-template-columns:88px 1fr;gap:12px;padding:15px 13px}.sheetHead .brand{height:70px;border-radius:12px;padding:8px}.sheetHead img{max-height:54px}.sheetHead .brand strong{font-size:17px}.sheetHead h1{font-size:28px}.sheetHead p{font-size:14px}.products{grid-template-columns:1fr;padding:10px;gap:10px}.product{grid-template-columns:40% 1fr;min-height:150px;border-radius:13px}.photo{min-height:145px}.productBody{padding:13px 11px}.product h2{font-size:17px;margin-bottom:9px}.prices strong{font-size:26px}.sheet footer{margin:0 10px 12px}}
@media print{body{background:#fff}.viewerBar{display:none}.stage{padding:0}.sheet{display:block!important;transform:none!important;box-shadow:none;width:100%;min-height:0;page-break-after:always}.sheet:last-child{page-break-after:auto}}
</style></head><body>
<nav class="viewerBar"><div class="group"><button id="prev" type="button" aria-label="Předchozí stránka">‹</button><span class="count"><b id="current">1</b> / ${pages.length}</span><button id="next" type="button" aria-label="Další stránka">›</button></div><div class="group"><button id="minus" class="desktopOnly" type="button" aria-label="Oddálit">−</button><button id="plus" class="desktopOnly" type="button" aria-label="Přiblížit">+</button><button id="print" type="button" aria-label="Tisk nebo uložit PDF">🖨</button><a href="${OFFICIAL_URL}" target="_blank" rel="noopener" aria-label="Otevřít Action">↗</a></div></nav>
<main class="stage">${pageMarkup}</main>
<script>(()=>{const pages=[...document.querySelectorAll('.sheet')],current=document.getElementById('current');let page=0,zoom=1;function show(next){page=Math.max(0,Math.min(pages.length-1,next));pages.forEach((el,index)=>el.classList.toggle('active',index===page));current.textContent=String(page+1);scrollTo({top:0,behavior:'smooth'})}function scale(next){zoom=Math.max(.7,Math.min(1.45,next));document.documentElement.style.setProperty('--zoom',String(zoom))}document.getElementById('prev').onclick=()=>show(page-1);document.getElementById('next').onclick=()=>show(page+1);document.getElementById('minus').onclick=()=>scale(zoom-.1);document.getElementById('plus').onclick=()=>scale(zoom+.1);document.getElementById('print').onclick=()=>print();addEventListener('keydown',event=>{if(event.key==='ArrowLeft')show(page-1);if(event.key==='ArrowRight')show(page+1)});show(0)})()<\/script></body></html>`;
  }

  function fitViewer() {
    if (viewer.hidden || frame.hidden) return;
    const top = Math.max(frame.getBoundingClientRect().top, innerWidth <= 520 ? 76 : 96);
    frame.style.width = '100%';
    frame.style.maxWidth = '100%';
    frame.style.height = `${Math.max(innerWidth <= 520 ? 420 : 520, innerHeight - top - 10)}px`;
  }

  async function openActionViewer(shouldScroll = true) {
    controller?.abort();
    controller = new AbortController();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';

    title.textContent = 'Action';
    status.hidden = false;
    status.className = 'leafletViewerStatus loading';
    status.textContent = 'Načítám aktuální Action leták…';
    frame.removeAttribute('src');
    frame.hidden = true;
    viewer.hidden = false;
    const mobile = matchMedia('(max-width: 820px)').matches;
    document.body.classList.toggle('leaflet-viewer-open', mobile);
    if (shouldScroll && !mobile) viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const { store, offers } = await loadActionData(controller.signal);
      const documentHtml = buildLeafletDocument(store, offers);
      objectUrl = URL.createObjectURL(new Blob([documentHtml], { type: 'text/html;charset=utf-8' }));
      frame.src = objectUrl;
      frame.hidden = false;
      status.hidden = true;
      requestAnimationFrame(fitViewer);
      setTimeout(fitViewer, 300);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      status.hidden = false;
      status.className = 'leafletViewerStatus error';
      status.innerHTML = `<strong>Action leták se nepodařilo načíst.</strong><span>${esc(error?.message || 'Zkus stránku znovu načíst.')}</span>`;
    }
  }

  function enhanceCard() {
    const current = grid.querySelector('.leafletCard');
    if (!current || current.dataset.actionViewer === 'true') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = current.className;
    button.innerHTML = current.innerHTML;
    button.dataset.actionViewer = 'true';
    button.querySelector('.leafletAction')?.replaceChildren('Prolistovat přímo zde');
    current.replaceWith(button);
    button.addEventListener('click', () => openActionViewer(true));
    if (!autoOpened && !matchMedia('(max-width: 820px)').matches) {
      autoOpened = true;
      openActionViewer(false);
    }
  }

  new MutationObserver(enhanceCard).observe(grid, { childList: true, subtree: true });
  closeButton?.addEventListener('click', () => {
    controller?.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    frame.removeAttribute('src');
  });
  window.addEventListener('resize', fitViewer);
  window.addEventListener('orientationchange', () => setTimeout(fitViewer, 150));
  enhanceCard();
})();
