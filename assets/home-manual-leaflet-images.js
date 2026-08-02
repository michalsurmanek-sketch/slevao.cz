(() => {
  'use strict';
  if (window.__slevaoManualLeafletImagesLoaded) return;
  window.__slevaoManualLeafletImagesLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const BUCKET = 'homepage-leaflet-images';
  const checks = new Map();
  let scheduled = 0;

  function slugFromCard(card) {
    const href = card.querySelector('.leafletCoverLink[href],.leafletAction a[href]')?.getAttribute('href') || '';
    try {
      const path = new URL(href, document.baseURI).pathname;
      return decodeURIComponent(path.split('/').pop() || '').replace(/\.html$/i, '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function publicUrl(slug) {
    const version = Math.floor(Date.now() / 300000);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(slug)}/cover?v=${version}`;
  }

  function imageExists(slug) {
    const cached = checks.get(slug);
    if (cached && Date.now() - cached.savedAt < 60000) return cached.promise;
    const url = publicUrl(slug);
    const promise = new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(url);
      probe.onerror = () => resolve('');
      probe.src = url;
    });
    checks.set(slug, { savedAt: Date.now(), promise });
    return promise;
  }

  async function applyCard(card) {
    const slug = slugFromCard(card);
    const image = card.querySelector('.leafletFrontPage');
    if (!slug || !image) return;
    const url = await imageExists(slug);
    if (!url || !card.isConnected) return;
    if (image.dataset.manualLeafletUrl === url && image.src === url) return;

    card.dataset.manualLeafletCover = '1';
    image.dataset.manualLeafletUrl = url;
    image.src = url;
    image.alt = `Vlastní ukázková fotografie letáku ${card.querySelector('h3')?.textContent?.trim() || slug}`;
    image.style.objectFit = 'cover';
    card.querySelector('.leafletCurrentBadge')?.replaceChildren(document.createTextNode('Vlastní obrázek'));
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = 'Ukázková fotografie';
  }

  function applyAll() {
    document.querySelectorAll('#leafletGrid .leafletCard').forEach((card) => applyCard(card));
  }

  function schedule() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(applyAll, 60);
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    new MutationObserver(schedule).observe(grid, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    applyAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
