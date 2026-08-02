(() => {
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const OFFICIAL_URL = 'https://www.lidl.cz/c/akcni-letak/s10008644';
  const grid = document.getElementById('leafletGrid');
  const viewer = document.getElementById('leafletViewer');
  const frame = document.getElementById('leafletFrame');
  const status = document.getElementById('leafletViewerStatus');
  const title = document.getElementById('leafletViewerTitle');
  const close = document.getElementById('closeLeafletViewer');
  if (!grid || !viewer || !frame || !status || !title) return;

  let objectUrl = '';
  let requestController = null;
  let autoOpened = false;
  let changingGrid = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const date = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : '';

  async function rest(table, params, signal) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error(`Databáze odpověděla chybou ${response.status}.`);
    return response.json();
  }

  async function loadData(signal) {
    const stores = await rest('stores', {
      select: 'id,name,logo_url,primary_color,is_active', slug: 'eq.lidl', is_active: 'eq.true', limit: '1',
    }, signal);
    const store = stores[0];
    if (!store) throw new Error('Lidl je v administraci skrytý nebo chybí v databázi.');
    const today = new Date().toISOString().slice(0, 10);
    const rows = await rest('offers', {
      select: 'id,title,price,old_price,image_url,valid_from,valid_to,published_at',
      store_id: `eq.${store.id}`, status: 'eq.published', valid_from: `lte.${today}`, valid_to: `gte.${today}`,
      order: 'published_at.desc', limit: '160',
    }, signal);
    const seen = new Set();
    const offers = rows.filter((offer) => {
      const key = `${String(offer.title || '').trim().toLowerCase()}|${offer.price}|${offer.valid_from}|${offer.valid_to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { store, offers };
  }

  function product(offer) {
    const current = Number(offer.price || 0);
    const previous = Number(offer.old_price || 0);
    const discount = previous > current ? Math.round((previous - current) / previous * 100) : 0;
    return `<article class="product"><div class="photo">${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.title)}" onerror="this.remove()">` : '<b>LIDL</b>'}${discount ? `<span>−${discount} %</span>` : ''}</div><div class="info"><h2>${esc(offer.title)}</h2><div class="prices"><strong>${money(current)} Kč</strong>${previous > current ? `<s>${money(previous)} Kč</s>` : ''}</div><small>AKTUÁLNÍ NABÍDKA LIDL</small></div></article>`;
  }

  function leafletHtml(store, offers) {
    const perPage = 8;
    const pages = [];
    for (let index = 0; index < offers.length; index += perPage) pages.push(offers.slice(index, index + perPage));
    if (!pages.length) pages.push([]);
    const from = offers.map((item) => item.valid_from).filter(Boolean).sort()[0] || '';
    const to = offers.map((item) => item.valid_to).filter(Boolean).sort().at(-1) || '';
    const primary = /^#[0-9a-f]{6}$/i.test(store.primary_color || '') ? store.primary_color : '#0050aa';
    const logo = String(store.logo_url || '');
    const sheets = pages.map((page, index) => `<section class="sheet${index === 0 ? ' active' : ''}"><header><div class="brand">${logo ? `<img src="${esc(logo)}" alt="Lidl">` : '<b>LIDL</b>'}</div><div><small>AKTUÁLNÍ LETÁK</small><h1>To se vyplatí.</h1><p>${from && to ? `${date(from)} – ${date(to)}` : 'Aktuální nabídka'}</p></div></header>${page.length ? `<main>${page.map(product).join('')}</main>` : `<div class="empty"><h2>Aktuální produkty se právě načítají.</h2><a href="${OFFICIAL_URL}" target="_blank" rel="noopener">Otevřít oficiální Lidl leták</a></div>`}<footer><span>Lidl. To se vyplatí.</span><b>${index + 1}</b></footer></section>`).join('');

    return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lidl leták</title><style>
    :root{--blue:${primary};--yellow:#ffdd00;--red:#e30613}*{box-sizing:border-box}html,body{margin:0;background:#2f3133;font-family:Arial,sans-serif;color:#10212d}.bar{position:sticky;top:0;z-index:5;height:58px;padding:8px 12px;background:#383838;color:#fff;display:flex;align-items:center;justify-content:space-between}.group{display:flex;align-items:center;gap:7px}.bar button,.bar a{height:38px;min-width:38px;border:0;border-radius:8px;background:#222;color:#fff;display:grid;place-items:center;padding:0 12px;text-decoration:none;font-weight:800;cursor:pointer}.stage{padding:16px}.sheet{display:none;width:min(920px,100%);min-height:1120px;margin:auto;background:#fff;box-shadow:0 10px 35px #0008}.sheet.active{display:block}.sheet>header{display:grid;grid-template-columns:180px 1fr;gap:24px;align-items:center;padding:28px 32px;background:linear-gradient(135deg,var(--yellow) 0 58%,var(--blue) 58%);color:#07336b}.brand{height:105px;padding:12px;border:5px solid var(--blue);border-radius:18px;background:#fff;display:grid;place-items:center}.brand img{max-width:100%;max-height:75px}.brand b{font-size:34px}.sheet h1{font-size:44px;margin:4px 0}.sheet header small{font-weight:900;letter-spacing:.12em}.sheet header p{margin:0;font-size:18px;font-weight:700}.sheet main{display:grid;grid-template-columns:1fr 1fr;gap:15px;padding:22px}.product{min-height:210px;border:2px solid #e1e8ec;border-radius:16px;overflow:hidden;display:grid;grid-template-columns:44% 1fr}.photo{position:relative;background:#f5f7f8;display:grid;place-items:center;overflow:hidden}.photo img{width:100%;height:100%;object-fit:contain;padding:8px}.photo>b{font-size:21px;color:#a8b4ba}.photo span{position:absolute;top:8px;left:8px;background:var(--red);color:#fff;border-radius:999px;padding:7px 9px;font-weight:900}.info{padding:17px 14px;display:flex;flex-direction:column}.info h2{font-size:19px;line-height:1.18;margin:0 0 12px}.prices{margin-top:auto;display:flex;align-items:end;gap:8px;flex-wrap:wrap}.prices strong{font-size:29px;color:var(--red)}.prices s{color:#67757c}.info small{margin-top:8px;color:var(--blue);font-weight:900}.sheet>footer{margin:0 22px 20px;padding:13px 16px;border-radius:11px;background:var(--blue);color:#fff;display:flex;justify-content:space-between;font-weight:900}.empty{min-height:820px;display:grid;place-content:center;text-align:center}.empty a{margin:12px auto;padding:13px 18px;border-radius:10px;background:var(--blue);color:#fff;text-decoration:none;font-weight:900}
    @media(max-width:650px){.stage{padding:0}.sheet{width:100%;min-height:calc(100vh - 58px);box-shadow:none}.sheet>header{grid-template-columns:86px 1fr;gap:11px;padding:13px}.brand{height:68px;padding:7px;border-width:3px}.brand img{max-height:50px}.brand b{font-size:18px}.sheet h1{font-size:27px}.sheet header p{font-size:13px}.sheet main{grid-template-columns:1fr;padding:9px;gap:9px}.product{min-height:145px;grid-template-columns:40% 1fr}.info{padding:12px 10px}.info h2{font-size:16px}.prices strong{font-size:25px}.sheet>footer{margin:0 9px 10px}}
    @media print{body{background:#fff}.bar{display:none}.stage{padding:0}.sheet{display:block!important;box-shadow:none;width:100%;min-height:0;page-break-after:always}}
    </style></head><body><nav class="bar"><div class="group"><button id="prev">‹</button><span><b id="current">1</b> / ${pages.length}</span><button id="next">›</button></div><div class="group"><button id="print">🖨</button><a href="${OFFICIAL_URL}" target="_blank" rel="noopener">↗</a></div></nav><div class="stage">${sheets}</div><script>(()=>{const pages=[...document.querySelectorAll('.sheet')],current=document.getElementById('current');let page=0;function show(value){page=Math.max(0,Math.min(pages.length-1,value));pages.forEach((item,index)=>item.classList.toggle('active',index===page));current.textContent=page+1;scrollTo(0,0)}prev.onclick=()=>show(page-1);next.onclick=()=>show(page+1);print.onclick=()=>window.print();show(0)})()<\/script></body></html>`;
  }

  function fit() {
    if (viewer.hidden || frame.hidden) return;
    const top = Math.max(frame.getBoundingClientRect().top, innerWidth <= 520 ? 76 : 96);
    frame.style.width = '100%';
    frame.style.height = `${Math.max(innerWidth <= 520 ? 420 : 520, innerHeight - top - 10)}px`;
  }

  async function openViewer(scroll = true) {
    requestController?.abort();
    requestController = new AbortController();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    title.textContent = 'Lidl';
    status.hidden = false;
    status.className = 'leafletViewerStatus loading';
    status.textContent = 'Načítám aktuální Lidl leták…';
    frame.removeAttribute('src');
    frame.hidden = true;
    viewer.hidden = false;
    const mobile = matchMedia('(max-width:820px)').matches;
    document.body.classList.toggle('leaflet-viewer-open', mobile);
    if (scroll && !mobile) viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const { store, offers } = await loadData(requestController.signal);
      objectUrl = URL.createObjectURL(new Blob([leafletHtml(store, offers)], { type: 'text/html;charset=utf-8' }));
      frame.src = objectUrl;
      frame.hidden = false;
      status.hidden = true;
      requestAnimationFrame(fit);
      setTimeout(fit, 250);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      status.className = 'leafletViewerStatus error';
      status.innerHTML = `<strong>Lidl leták se nepodařilo načíst.</strong><span>${esc(error?.message || 'Zkus stránku obnovit.')}</span>`;
    }
  }

  function fallbackCard() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'leafletCard';
    button.dataset.lidlFallback = 'true';
    button.innerHTML = '<div class="leafletCover"><strong class="leafletBrand">LIDL</strong><span>Lidl</span></div><div class="leafletBody"><span class="leafletType">AKČNÍ LETÁK</span><h3>Lidl</h3><p>Aktuální nabídka</p><div class="leafletValidity">Platnost podle aktuálních nabídek</div><span class="leafletAction">Prolistovat přímo zde →</span></div>';
    button.addEventListener('click', () => openViewer(true));
    return button;
  }

  function enhance() {
    if (changingGrid || grid.querySelector('.leafletCard')) return;
    if (!grid.querySelector('.leafletError')) return;
    changingGrid = true;
    grid.innerHTML = '';
    grid.appendChild(fallbackCard());
    grid.dataset.count = '1';
    changingGrid = false;
    if (!autoOpened && !matchMedia('(max-width:820px)').matches) {
      autoOpened = true;
      openViewer(false);
    }
  }

  new MutationObserver(enhance).observe(grid, { childList: true, subtree: true });
  close?.addEventListener('click', () => {
    requestController?.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    frame.removeAttribute('src');
  });
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 150));
  enhance();
})();
