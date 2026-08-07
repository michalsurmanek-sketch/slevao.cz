(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const db = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  if (!db) return;

  const productId = new URLSearchParams(location.search).get('id');
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const date = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '–';

  function quantity(value) {
    const text = fold(value);
    const multi = text.match(/\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/i);
    const match = multi || text.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/i);
    if (!match) return null;
    let amount;
    let unit;
    if (multi) {
      amount = Number(multi[1]) * Number(String(multi[2]).replace(',', '.'));
      unit = multi[3].toLowerCase();
    } else {
      amount = Number(String(match[1]).replace(',', '.'));
      unit = match[2].toLowerCase();
    }
    if (!(amount > 0)) return null;
    if (unit === 'kg') return { family:'mass', amount:amount * 1000 };
    if (unit === 'g') return { family:'mass', amount };
    if (unit === 'mg') return { family:'mass', amount:amount / 1000 };
    if (unit === 'l') return { family:'volume', amount:amount * 1000 };
    if (unit === 'cl') return { family:'volume', amount:amount * 10 };
    if (unit === 'ml') return { family:'volume', amount };
    if (unit === 'ks') return { family:'count', amount };
    return null;
  }

  function sameQuantity(left, right) {
    if (!left || !right || left.family !== right.family) return false;
    return Math.abs(left.amount - right.amount) <= Math.max(left.amount, right.amount) * .02;
  }

  function runtimeIdentityConsistent(current, other) {
    const leftBrand = fold(current?.brand);
    const rightBrand = fold(other?.brand);
    if (!leftBrand || leftBrand !== rightBrand) return false;
    const leftQty = quantity(current?.quantity_text || current?.name);
    const rightQty = quantity(other?.quantity_text || other?.name);
    return sameQuantity(leftQty, rightQty);
  }

  async function equivalenceLinks(id) {
    const { data, error } = await db.from('product_equivalences')
      .select('product_id_a,product_id_b,match_method,confidence')
      .eq('is_active', true)
      .gte('confidence', .99)
      .or(`product_id_a.eq.${id},product_id_b.eq.${id}`)
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  function counterpartIds(links, id) {
    const result = new Set();
    for (const link of links) {
      if (String(link.product_id_a) === String(id)) result.add(String(link.product_id_b));
      if (String(link.product_id_b) === String(id)) result.add(String(link.product_id_a));
    }
    return [...result];
  }

  async function loadProducts(ids) {
    const all = [productId, ...ids];
    const { data, error } = await db.from('products')
      .select('id,name,brand,quantity_text,is_verified')
      .in('id', all)
      .limit(60);
    if (error) throw error;
    return data || [];
  }

  async function loadOffers(ids) {
    if (!ids.length) return [];
    const { data, error } = await db.from('offers')
      .select('id,product_id,store_id,title,price,old_price,valid_from,valid_to,stores(id,name,slug)')
      .in('product_id', ids)
      .eq('status', 'published')
      .lte('valid_from', upcomingTo)
      .gte('valid_to', today)
      .limit(300);
    if (error) throw error;
    return data || [];
  }

  function offerHtml(offer) {
    const upcoming = String(offer.valid_from || '') > today;
    const store = offer.stores || {};
    const validity = upcoming ? `od ${date(offer.valid_from)} do ${date(offer.valid_to)}` : `do ${date(offer.valid_to)}`;
    const storeUrl = store.slug ? `${encodeURIComponent(store.slug)}.html` : `produkt.html?id=${encodeURIComponent(offer.product_id)}`;
    return `<a class="sfEqOffer" href="${esc(storeUrl)}"><span><b>${esc(store.name || 'Obchod')}</b><small>${esc(validity)}${upcoming ? ' · brzy' : ''}</small></span><strong>${money(offer.price)} Kč</strong></a>`;
  }

  function render(current, products, offers, links) {
    const safeProducts = products.filter((row) => row.id !== current.id && row.is_verified === true && runtimeIdentityConsistent(current, row));
    if (!safeProducts.length) return;
    const safeIds = new Set(safeProducts.map((row) => String(row.id)));
    const safeOffers = offers.filter((row) => safeIds.has(String(row.product_id)) && Number(row.price) > 0);
    if (!safeOffers.length) return;

    const productBlocks = safeProducts.map((row) => {
      const rows = safeOffers
        .filter((offer) => String(offer.product_id) === String(row.id))
        .sort((a,b) => Number(String(a.valid_from || '') > today) - Number(String(b.valid_from || '') > today) || Number(a.price) - Number(b.price));
      if (!rows.length) return '';
      const link = links.find((item) => String(item.product_id_a) === String(row.id) || String(item.product_id_b) === String(row.id));
      return `<article class="sfEqProduct"><div class="sfEqProductTop"><div><b>${esc(row.name)}</b><small>${esc([row.brand,row.quantity_text].filter(Boolean).join(' · '))}</small></div><span class="sfEqEvidence">${link?.match_method === 'manual_review' ? 'ručně ověřeno' : 'ověřená equivalence'} · ${Math.round(Number(link?.confidence || 1) * 100)} %</span></div><div class="sfEqOffers">${rows.map(offerHtml).join('')}</div></article>`;
    }).filter(Boolean).join('');
    if (!productBlocks) return;

    const sourceSection = document.getElementById('offers')?.closest('.sfSection');
    if (!sourceSection || document.getElementById('productEquivalence')) return;
    const section = document.createElement('section');
    section.id = 'productEquivalence';
    section.className = 'sfSection sfEqSection';
    section.innerHTML = `<div class="sfEqPanel"><div class="sfEqHead"><div><span class="sfEqBadge">ověřená identita produktu</span><h2>Stejný výrobek vedený pod jiným záznamem</h2><p>Tyto ceny přidáváme pouze z ručně nebo evidenčně potvrzených master produktů. Původní cenovou historii výše nemícháme, aby bylo jasné, odkud data pocházejí.</p></div><div class="sfEqCount"><strong>${new Set(safeOffers.map((row) => row.store_id)).size}</strong><span>další obchody</span></div></div><div class="sfEqProducts">${productBlocks}</div><p class="sfEqNote">SLEVAO equivalence není fuzzy podobnost názvu. Veřejně se používají jen aktivní vazby s confidence alespoň 99 % a při zobrazení se znovu kontroluje značka i balení.</p></div>`;
    sourceSection.after(section);
  }

  async function init() {
    if (!productId) return;
    try {
      const links = await equivalenceLinks(productId);
      if (!links.length) return;
      const ids = counterpartIds(links, productId);
      if (!ids.length) return;
      const [products, offers] = await Promise.all([loadProducts(ids), loadOffers(ids)]);
      const current = products.find((row) => String(row.id) === String(productId));
      if (!current?.is_verified) return;
      render(current, products, offers, links);
    } catch (error) {
      console.warn('SLEVAO product equivalence:', error?.message || error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
