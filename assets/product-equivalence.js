(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const productId = new URLSearchParams(location.search).get('id');
  if (!productId) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits:2 });
  const date = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`))
    : '–';

  function pragueDate(offsetDays = 0) {
    const target = new Date(Date.now() + offsetDays * 86400000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(target);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  const today = pragueDate();
  const upcomingTo = pragueDate(7);

  async function getDb(timeout = 5000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
    if (window.supabase?.createClient) return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
      if (window.supabase?.createClient) return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    throw new Error('Datové služby nejsou dostupné.');
  }

  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function quantity(value) {
    const raw = String(value || '').toLowerCase().replace(/,/g, '.');
    const multi = raw.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/i);
    const single = raw.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/i);
    const match = multi || single;
    if (!match) return null;

    let amount;
    let unit;
    if (multi) {
      amount = Number(multi[1]) * Number(multi[2]);
      unit = multi[3].toLowerCase();
    } else {
      amount = Number(single[1]);
      unit = single[2].toLowerCase();
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

  function identityConsistent(current, other) {
    const currentBrand = fold(current?.brand);
    const otherBrand = fold(other?.brand);
    if (!currentBrand || currentBrand !== otherBrand) return false;
    const currentQuantity = quantity(current?.quantity_text || current?.name);
    const otherQuantity = quantity(other?.quantity_text || other?.name);
    return sameQuantity(currentQuantity, otherQuantity);
  }

  async function equivalenceLinks(db) {
    const { data, error } = await db.from('product_equivalences')
      .select('product_id_a,product_id_b,match_method,confidence,evidence')
      .eq('is_active', true)
      .gte('confidence', .99)
      .or(`product_id_a.eq.${productId},product_id_b.eq.${productId}`)
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  function counterpartIds(links) {
    const ids = new Set();
    for (const link of links) {
      if (String(link.product_id_a) === String(productId)) ids.add(String(link.product_id_b));
      if (String(link.product_id_b) === String(productId)) ids.add(String(link.product_id_a));
    }
    return [...ids];
  }

  async function loadProducts(db, ids) {
    const { data, error } = await db.from('products')
      .select('id,name,brand,quantity_text,image_url,is_verified,is_active')
      .in('id', [productId, ...ids])
      .limit(60);
    if (error) throw error;
    return data || [];
  }

  async function loadOffers(db, ids) {
    if (!ids.length) return [];
    const { data, error } = await db.from('offers')
      .select('id,product_id,store_id,title,price,old_price,valid_from,valid_to,stores(id,name,slug,logo_url)')
      .in('product_id', ids)
      .eq('status', 'published')
      .lte('valid_from', upcomingTo)
      .gte('valid_to', today)
      .limit(500);
    if (error) throw error;
    return data || [];
  }

  function bestOffersPerStore(rows) {
    const result = new Map();
    for (const row of rows || []) {
      const storeId = String(row.store_id || '');
      const price = Number(row.price || 0);
      if (!storeId || !(price > 0)) continue;
      const existing = result.get(storeId);
      if (!existing) {
        result.set(storeId, row);
        continue;
      }
      const current = String(row.valid_from || '') <= today;
      const existingCurrent = String(existing.valid_from || '') <= today;
      if ((current && !existingCurrent) || (current === existingCurrent && price < Number(existing.price || Infinity))) {
        result.set(storeId, row);
      }
    }
    return [...result.values()].sort((a, b) => {
      const aUpcoming = String(a.valid_from || '') > today;
      const bUpcoming = String(b.valid_from || '') > today;
      return Number(aUpcoming) - Number(bUpcoming) || Number(a.price) - Number(b.price);
    });
  }

  function evidenceLabel(link) {
    const confidence = Math.round(Number(link?.confidence || 0) * 100);
    const method = String(link?.match_method || '');
    const prefix = method.includes('curated') || method.includes('manual') ? 'ověřeno' : 'evidenčně ověřeno';
    return `${prefix} · ${confidence} %`;
  }

  function offerHtml(offer) {
    const store = offer.stores || {};
    const upcoming = String(offer.valid_from || '') > today;
    const validity = upcoming
      ? `od ${date(offer.valid_from)} do ${date(offer.valid_to)}`
      : `platí do ${date(offer.valid_to)}`;
    const logo = store.logo_url
      ? `<span class="sfEqStoreLogo"><img src="${esc(store.logo_url)}" alt="" loading="lazy"></span>`
      : '<span class="sfEqStoreLogo sfEqStoreFallback" aria-hidden="true">%</span>';
    return `<article class="sfEqOffer">
      <div class="sfEqStore">${logo}<span><b>${esc(store.name || 'Obchod')}</b><small>${esc(validity)}${upcoming ? ' · brzy' : ''}</small></span></div>
      <strong>${money(offer.price)} Kč</strong>
      <div class="sfEqOfferActions"><a href="produkt.html?id=${encodeURIComponent(offer.product_id)}">Detail</a>${store.slug ? `<a href="${encodeURIComponent(store.slug)}.html">Obchod</a>` : ''}</div>
    </article>`;
  }

  function render(current, products, offers, links) {
    const safeProducts = products.filter((row) =>
      String(row.id) !== String(current.id)
      && row.is_verified === true
      && row.is_active !== false
      && identityConsistent(current, row)
    );
    if (!safeProducts.length) return;

    const blocks = [];
    const allSafeOffers = [];
    for (const row of safeProducts) {
      const rows = bestOffersPerStore(offers.filter((offer) => String(offer.product_id) === String(row.id)));
      if (!rows.length) continue;
      allSafeOffers.push(...rows);
      const link = links.find((item) =>
        String(item.product_id_a) === String(row.id) || String(item.product_id_b) === String(row.id)
      );
      blocks.push(`<article class="sfEqProduct">
        <div class="sfEqProductTop">
          <div><b>${esc(row.name)}</b><small>${esc([row.brand, row.quantity_text].filter(Boolean).join(' · '))}</small></div>
          <span class="sfEqEvidence">${esc(evidenceLabel(link))}</span>
        </div>
        <div class="sfEqOffers">${rows.map(offerHtml).join('')}</div>
      </article>`);
    }
    if (!blocks.length) return;

    const sourceSection = document.getElementById('offers')?.closest('.sfSection');
    if (!sourceSection || document.getElementById('productEquivalence')) return;
    const uniqueStores = new Set(allSafeOffers.map((row) => String(row.store_id || '')).filter(Boolean)).size;
    const section = document.createElement('section');
    section.id = 'productEquivalence';
    section.className = 'sfSection sfEqSection';
    section.innerHTML = `<div class="sfEqPanel">
      <div class="sfEqHead">
        <div><span class="sfEqBadge">Ověřená identita produktu</span><h2>Další ověřené ceny stejného výrobku</h2><p>Tyto nabídky pocházejí z jiných master záznamů, které byly ověřeny jako stejný výrobek. Nemícháme je do cenové historie výše, aby zůstal původ dat jednoznačný.</p></div>
        <div class="sfEqCount"><strong>${uniqueStores}</strong><span>${uniqueStores === 1 ? 'obchod' : uniqueStores < 5 ? 'obchody' : 'obchodů'}</span></div>
      </div>
      <div class="sfEqProducts">${blocks.join('')}</div>
      <p class="sfEqNote">Zobrazují se pouze aktivní vazby s jistotou alespoň 99 %, ověřené produkty a shodná značka i balení. Nejde o pouhou podobnost názvu.</p>
    </div>`;
    sourceSection.after(section);
  }

  async function init() {
    try {
      const db = await getDb();
      const links = await equivalenceLinks(db);
      if (!links.length) return;
      const ids = counterpartIds(links);
      if (!ids.length) return;
      const [products, offers] = await Promise.all([loadProducts(db, ids), loadOffers(db, ids)]);
      const current = products.find((row) => String(row.id) === String(productId));
      if (!current?.is_verified || current.is_active === false) return;
      render(current, products, offers, links);
    } catch (error) {
      console.warn('SLEVAO ověřené ekvivalence:', error?.message || error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
