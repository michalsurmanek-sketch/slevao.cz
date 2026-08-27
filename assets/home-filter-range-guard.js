(() => {
  'use strict';

  const minPrice = document.getElementById('minPrice');
  const maxPrice = document.getElementById('maxPrice');
  let addQueue = Promise.resolve();

  if (minPrice && maxPrice) {
    document.querySelectorAll('.pricePresets [data-max-price]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = Number(button.dataset.maxPrice);
        const min = minPrice.value === '' ? null : Number(minPrice.value);
        if (Number.isFinite(preset) && Number.isFinite(min) && min > preset) {
          minPrice.value = '';
          minPrice.dispatchEvent(new Event('input', { bubbles:true }));
        }
      }, { capture:true });
    });
  }

  async function publicApi(timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (window.SlevaoPublic?.getSupabase && window.SlevaoPublic?.addItemFromOffer) return window.SlevaoPublic;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    throw new Error('Nákupní seznam se ještě nenačetl. Zkus přidání znovu.');
  }

  async function loadOffer(db, offerId) {
    const { data, error } = await db.from('offers')
      .select('id,product_id,store_id,title,price,old_price,image_url,products(id,name,brand,quantity_text,image_url),stores(id,name,slug)')
      .eq('id', offerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Nabídka už není dostupná.');
    return data;
  }

  async function ensureRemoteList(db, userId) {
    const { data: existing, error } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending:true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (existing?.id) return existing.id;

    const { data, error: createError } = await db.from('shopping_lists')
      .insert({ user_id:userId, name:'Můj nákup' })
      .select('id')
      .single();
    if (createError) throw createError;
    return data.id;
  }

  async function findRemoteItem(db, listId, offer) {
    const base = () => db.from('shopping_list_items')
      .select('id,quantity,is_completed')
      .eq('shopping_list_id', listId)
      .order('is_completed', { ascending:true })
      .order('created_at', { ascending:true })
      .limit(1);

    if (offer.product_id) {
      const { data, error } = await base().eq('product_id', offer.product_id).maybeSingle();
      if (error) throw error;
      return data || null;
    }

    const byOffer = await base().eq('selected_offer_id', offer.id).maybeSingle();
    if (byOffer.error) throw byOffer.error;
    if (byOffer.data) return byOffer.data;

    const customName = String(offer.title || '').trim();
    if (!customName) return null;
    const byName = await base().is('product_id', null).eq('custom_name', customName).maybeSingle();
    if (byName.error) throw byName.error;
    return byName.data || null;
  }

  async function addRemoteItem(db, listId, offer) {
    const existing = await findRemoteItem(db, listId, offer);
    const nextQuantity = existing
      ? (existing.is_completed ? 1 : Math.max(0.01, Number(existing.quantity || 1)) + 1)
      : 1;
    const payload = {
      shopping_list_id:listId,
      product_id:offer.product_id || null,
      selected_offer_id:offer.id,
      custom_name:offer.product_id ? null : String(offer.title || 'Produkt'),
      quantity:nextQuantity,
      unit:'ks',
      is_completed:false
    };

    if (existing?.id) {
      const { data, error } = await db.from('shopping_list_items')
        .update(payload)
        .eq('id', existing.id)
        .eq('shopping_list_id', listId)
        .select('id,quantity,is_completed')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await db.from('shopping_list_items')
      .insert(payload)
      .select('id,quantity,is_completed')
      .single();
    if (error) throw error;
    return data;
  }

  function alignLocalRow(api, offer, remoteRow) {
    api.addItemFromOffer(offer);
    const rows = api.readList?.() || [];
    const key = offer.product_id ? `p:${offer.product_id}` : `o:${offer.id}`;
    const matches = rows.filter((row) => row?.key === key);
    const active = matches.find((row) => !row.completed && !row.is_completed) || matches[0];
    if (!active) return;

    active.server_id = remoteRow?.id || active.server_id || null;
    active.quantity = Math.max(0.01, Number(remoteRow?.quantity || active.quantity || 1));
    active.completed = false;
    active.is_completed = false;
    active.selected_offer_id = offer.id;
    active.updated_at = new Date().toISOString();

    const normalized = rows.filter((row) => row === active || row?.key !== key);
    api.writeList?.(normalized);
  }

  function feedback(button, message) {
    const original = button.getAttribute('data-sf-account-sync-label') || button.textContent.trim();
    button.setAttribute('data-sf-account-sync-label', original);
    button.textContent = 'Přidáno ✓';
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = original;
      button.removeAttribute('data-sf-account-sync-label');
    }, 1700);
    window.SlevaoPublic?.toast?.(message);
  }

  async function addFromHomepage(button) {
    const api = await publicApi();
    const db = await api.getSupabase();
    const offerId = String(button.dataset.sfAdd || '').trim();
    if (!offerId) return;
    const offer = await loadOffer(db, offerId);
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;

    if (!session?.user?.id) {
      api.addItemFromOffer(offer);
      feedback(button, 'Produkt byl přidán do nákupního seznamu.');
      return;
    }

    const listId = await ensureRemoteList(db, session.user.id);
    const remoteRow = await addRemoteItem(db, listId, offer);
    alignLocalRow(api, offer, remoteRow);
    feedback(button, 'Produkt byl přidán a synchronizován s účtem.');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sf-add]');
    if (!button || button.disabled) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;

    addQueue = addQueue
      .catch(() => {})
      .then(() => addFromHomepage(button))
      .catch((error) => {
        window.SlevaoPublic?.toast?.(error?.message || 'Produkt se nepodařilo přidat do seznamu.');
      })
      .finally(() => {
        if (button.isConnected) button.disabled = false;
      });
  }, true);

  window.__slevaoPriceRangeGuard = true;
  window.__slevaoAccountShoppingListAddGuard = true;
})();