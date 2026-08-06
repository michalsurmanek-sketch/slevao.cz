(() => {
  'use strict';

  const config = window.SLEVAO_STORE || {};
  if (String(config.slug || '').toLowerCase() !== 'jysk') return;

  const grid = document.getElementById('leafletCards');
  if (!grid) return;

  const supabaseUrl = String(config.supabaseUrl || 'https://uhampjdqjxmbhaptgitn.supabase.co').replace(/\/$/, '');
  const supabaseAnonKey = String(config.supabaseAnonKey || 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU');
  const endpoint = `${supabaseUrl}/functions/v1/store-leaflet-feed?store=jysk&source=official-v1`;
  let leaflets = [];

  function enhanceCards() {
    if (!leaflets.length) return;
    const cards = [...grid.querySelectorAll('.leaflet-card')];
    cards.forEach((card, index) => {
      const leaflet = leaflets[index];
      const button = card.querySelector('button.leaflet-preview-button');
      if (!leaflet?.url || !button) return;

      const link = document.createElement('a');
      link.className = button.className;
      link.href = leaflet.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.jyskDirect = '1';
      link.setAttribute('aria-label', `Otevřít ${leaflet.title || 'leták JYSK'}`);
      link.innerHTML = button.innerHTML;
      button.replaceWith(link);
    });
  }

  const observer = new MutationObserver(enhanceCards);
  observer.observe(grid, { childList: true, subtree: true });

  fetch(endpoint, {
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
    },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`JYSK feed HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      leaflets = Array.isArray(data?.leaflets) ? data.leaflets : [];
      enhanceCards();
    })
    .catch((error) => console.warn('Přímé otevření letáků JYSK není dostupné.', error));
})();
