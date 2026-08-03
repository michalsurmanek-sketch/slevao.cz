(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';

  function init() {
    if (window.__slevaoAdminSaveOfferV2Loaded || !window.supabase || !document.getElementById('saveBtn')) return;
    window.__slevaoAdminSaveOfferV2Loaded = true;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const $ = (id) => document.getElementById(id);
    const nullable = (value) => String(value || '').trim() || null;
    const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const today = () => new Date().toISOString().slice(0, 10);
    let selectedProductId = '';

    function setMessage(text, type = 'ok') {
      const box = $('formMsg');
      if (!box) return;
      box.textContent = text;
      box.className = `msg ${type}`;
    }

    async function requireStaff() {
      const { data, error } = await db.auth.getSession();
      const role = data.session?.user?.app_metadata?.role || '';
      if (error || !data.session) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
      if (!['admin', 'editor'].includes(role)) throw new Error('Účet nemá oprávnění ukládat nabídky.');
    }

    function validate() {
      const value = {
        name: $('title')?.value.trim() || '',
        storeId: $('store')?.value || '',
        categoryId: $('category')?.value || null,
        price: Number($('price')?.value),
        oldPrice: $('oldPrice')?.value ? Number($('oldPrice').value) : null,
        imageUrl: nullable($('image')?.value),
        validFrom: $('from')?.value || '',
        validTo: $('to')?.value || '',
        status: $('status')?.value || 'review',
      };

      if (!value.name || !value.storeId || !Number.isFinite(value.price) || value.price <= 0 || !value.validFrom || !value.validTo) {
        throw new Error('Vyplň název, obchod, kladnou cenu a platnost.');
      }
      if (value.oldPrice !== null && (!Number.isFinite(value.oldPrice) || value.oldPrice < value.price)) {
        throw new Error('Původní cena nesmí být nižší než akční cena.');
      }
      if (value.validFrom > value.validTo) throw new Error('Datum začátku nesmí být po datu konce.');
      if (value.status === 'published' && value.validTo < today()) throw new Error('Prošlou nabídku nelze publikovat.');
      return value;
    }

    function resetForm() {
      $('offerForm')?.reset();
      selectedProductId = '';
      const now = new Date();
      if ($('from')) $('from').value = now.toISOString().slice(0, 10);
      if ($('to')) $('to').value = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
      if ($('status')) $('status').value = 'published';
      $('title')?.dispatchEvent(new Event('input', { bubbles: true }));
      $('image')?.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function clearCache() {
      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('slevao-public-data-') || key === 'slevao-home-v2-data')
          .forEach((key) => localStorage.removeItem(key));
      } catch { /* Úložiště může být vypnuté. */ }
    }

    function missingRpc(error) {
      return error?.code === 'PGRST202' || /admin_create_offer_v2|schema cache|could not find/i.test(error?.message || '');
    }

    async function getProduct(value) {
      if (selectedProductId) {
        const result = await db.from('products')
          .select('id,name,category_id,image_url')
          .eq('id', selectedProductId)
          .maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error('Vybraný produkt už neexistuje. Vyber ho znovu.');
        return { product: result.data, created: false };
      }

      let result = await db.from('products')
        .select('id,name,category_id,image_url,image_quality,image_verified')
        .eq('normalized_name', fold(value.name))
        .order('image_verified', { ascending: false })
        .order('image_quality', { ascending: false })
        .limit(3);

      if (result.error && /normalized_name|image_quality|image_verified|column/i.test(result.error.message || '')) {
        result = await db.from('products')
          .select('id,name,category_id,image_url')
          .ilike('name', value.name)
          .limit(3);
      }
      if (result.error) throw result.error;

      const products = result.data || [];
      if (products.length > 1) {
        throw new Error('Nalezeno více stejných produktů. Klikni nejdřív na správný produkt v našeptávači.');
      }
      if (products.length === 1) return { product: products[0], created: false };

      const inserted = await db.from('products')
        .insert({ name: value.name, category_id: value.categoryId, image_url: value.imageUrl, is_verified: true })
        .select('id,name,category_id,image_url')
        .single();
      if (inserted.error) throw inserted.error;
      return { product: inserted.data, created: true };
    }

    async function fallbackSave(value) {
      const match = await getProduct(value);
      let createdProductId = match.created ? match.product.id : '';
      try {
        if (!match.created && ((value.imageUrl && !match.product.image_url) || (value.categoryId && !match.product.category_id))) {
          const update = await db.from('products').update({
            image_url: match.product.image_url || value.imageUrl,
            category_id: match.product.category_id || value.categoryId,
          }).eq('id', match.product.id);
          if (update.error) throw update.error;
        }

        const inserted = await db.from('offers').insert({
          product_id: match.product.id,
          store_id: value.storeId,
          category_id: value.categoryId,
          title: value.name,
          price: value.price,
          old_price: value.oldPrice,
          image_url: value.imageUrl || match.product.image_url || null,
          valid_from: value.validFrom,
          valid_to: value.validTo,
          status: value.status,
          is_verified: true,
          published_at: value.status === 'published' ? new Date().toISOString() : null,
        }).select('id').single();
        if (inserted.error) throw inserted.error;
        createdProductId = '';
      } finally {
        if (createdProductId) {
          const cleanup = await db.from('products').delete().eq('id', createdProductId);
          if (cleanup.error) console.error('Úklid osiřelého produktu selhal:', cleanup.error);
        }
      }
    }

    async function save() {
      const button = $('saveBtn');
      button.disabled = true;
      button.textContent = 'Ukládám…';
      try {
        await requireStaff();
        const value = validate();
        const chosenProductId = selectedProductId;
        const rpc = await db.rpc('admin_create_offer_v2', {
          product_name: value.name,
          target_store_id: value.storeId,
          target_category_id: value.categoryId,
          target_price: value.price,
          target_old_price: value.oldPrice,
          target_image_url: value.imageUrl,
          target_valid_from: value.validFrom,
          target_valid_to: value.validTo,
          target_status: value.status,
          target_product_id: chosenProductId || null,
        });

        if (rpc.error) {
          if (!missingRpc(rpc.error)) throw rpc.error;
          await fallbackSave(value);
        }

        clearCache();
        setMessage(chosenProductId
          ? 'Nabídka byla uložena k přesně vybranému existujícímu produktu.'
          : 'Nabídka byla bezpečně uložena.', 'ok');
        resetForm();
        $('reload')?.click();
      } catch (error) {
        setMessage(error?.message || 'Nabídku se nepodařilo uložit.', 'err');
      } finally {
        button.disabled = false;
        button.textContent = 'Uložit nabídku';
      }
    }

    window.addEventListener('click', (event) => {
      const product = event.target.closest?.('[data-critical-product]');
      if (product) {
        selectedProductId = product.dataset.criticalProduct || '';
        return;
      }

      const saveButton = event.target.closest?.('#saveBtn');
      if (!saveButton) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      save();
    }, true);

    $('title')?.addEventListener('input', (event) => {
      if (event.isTrusted) selectedProductId = '';
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
