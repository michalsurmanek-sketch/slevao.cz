(() => {
  'use strict';

  const productId = new URLSearchParams(location.search).get('id');
  if (!productId || !window.supabase) return;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits:2 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const upcoming = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(Date.now() + 7 * 86400000));

  const setText = (id, value) => {
    const node = $(id);
    if (node) node.textContent = value;
  };

  async function boot() {
    const started = performance.now();
    try {
      const [productResult, offersResult] = await Promise.all([
        db.from('products')
          .select('id,name,brand,ean,quantity_text,image_url')
          .eq('id', productId)
          .maybeSingle(),
        db.from('offers')
          .select('id,store_id,price,valid_from,valid_to,store_location_name,stores(name,slug,logo_url)')
          .eq('product_id', productId)
          .eq('status','published')
          .lte('valid_from', upcoming)
          .gte('valid_to', today)
          .order('price', { ascending:true })
          .limit(20)
      ]);

      if (productResult.error || !productResult.data) return;
      const product = productResult.data;
      const offers = offersResult.error ? [] : (offersResult.data || []);
      const cheapest = offers[0] || null;

      const nameNode = $('productName');
      if (nameNode && /^Načítám/i.test(nameNode.textContent || '')) nameNode.textContent = product.name;
      setText('productMeta', [product.brand, product.quantity_text, product.ean ? `EAN ${product.ean}` : ''].filter(Boolean).join(' · '));

      const image = $('productImage');
      if (image && product.image_url && image.querySelector('.sfLoading')) {
        image.innerHTML = `<img src="${esc(product.image_url)}" alt="${esc(product.name)}">`;
      }

      const price = $('currentPrice');
      if (price && (price.textContent.trim() === '—' || !price.textContent.trim())) {
        price.textContent = cheapest ? `${money(cheapest.price)} Kč` : 'Bez viditelné ceny';
      }

      const store = $('currentStore');
      if (store && cheapest) {
        const storeName = cheapest.stores?.name || 'Obchod';
        const locationName = String(cheapest.store_location_name || '').trim();
        const label = locationName ? `${storeName} · ${locationName}` : storeName;
        store.textContent = `Právě teď nejlevněji v ${label}`;
      }

      setText('statStores', String(new Set(offers.map((row) => `${row.store_id || ''}|${String(row.store_location_name || '').toLowerCase()}`)).size));
      document.documentElement.dataset.productFastReady = '1';
      document.documentElement.dataset.productFastMs = String(Math.round(performance.now() - started));
    } catch (error) {
      console.warn('Slevao quick product bootstrap skipped:', error);
    }
  }

  boot();
})();
