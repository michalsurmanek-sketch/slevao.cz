(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const MIN_QUERY = 2;
  const MAX_QUERY = 80;
  const LIMIT = 7;
  const DEBOUNCE_MS = 180;
  let timer = 0;
  let controller = null;

  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits:2 });

  function hide(box) {
    if (!box) return;
    box.hidden = true;
    box.replaceChildren();
  }

  function rowButton(row, index) {
    const offer = row?.offer || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestItem';
    button.dataset.suggestTitle = String(offer.title || offer.products?.name || '');
    button.dataset.index = String(index);

    const thumb = document.createElement('span');
    thumb.className = 'suggestThumb';
    if (offer.image_url) {
      const image = document.createElement('img');
      image.src = String(offer.image_url);
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.replaceWith(document.createTextNode('🏷️')), { once:true });
      thumb.appendChild(image);
    } else {
      thumb.textContent = '🏷️';
    }

    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = String(offer.products?.name || offer.title || 'Produkt');
    const store = document.createElement('small');
    store.textContent = String(offer.stores?.name || '');
    copy.append(title, store);

    const price = document.createElement('span');
    price.className = 'suggestPrice';
    price.textContent = `${money(offer.price)} Kč`;
    button.append(thumb, copy, price);
    return button;
  }

  function render(box, query, rows) {
    box.replaceChildren();
    const head = document.createElement('div');
    head.className = 'suggestHead';
    const total = Number(rows?.[0]?.total_count || rows?.length || 0);
    head.textContent = total > rows.length
      ? `Nejlepší shody pro „${query}“ · ${total.toLocaleString('cs-CZ')} nalezeno`
      : `Nejlepší shody pro „${query}“`;
    box.appendChild(head);
    rows.forEach((row, index) => box.appendChild(rowButton(row, index)));
    box.hidden = rows.length === 0;
  }

  async function search(query, box) {
    controller?.abort();
    controller = new AbortController();
    const timeout = window.setTimeout(() => controller?.abort(), 5000);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_public_offers`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          p_query: query.slice(0, MAX_QUERY),
          p_limit: LIMIT,
          p_offset: 0,
          p_store_slug: null,
          p_include_upcoming: true
        }),
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Search RPC ${response.status}`);
      const rows = await response.json();
      render(box, query, Array.isArray(rows) ? rows : []);
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('Serverové našeptávání není dostupné:', error);
      hide(box);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function init() {
    const input = document.getElementById('q');
    const box = document.getElementById('searchSuggestions');
    if (!input || !box) return;

    input.addEventListener('input', (event) => {
      event.stopImmediatePropagation();
      window.clearTimeout(timer);
      const query = String(input.value || '').trim();
      if (fold(query).length < MIN_QUERY) {
        controller?.abort();
        hide(box);
        return;
      }
      timer = window.setTimeout(() => search(query, box), DEBOUNCE_MS);
    }, { capture:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
