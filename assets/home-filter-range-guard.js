(() => {
  'use strict';

  const minPrice = document.getElementById('minPrice');
  const maxPrice = document.getElementById('maxPrice');
  let addQueue = Promise.resolve();
  let recipeQueue = Promise.resolve();
  let recipeBypass = false;
  const recipeSyncing = new WeakSet();

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
    active.selected_offer_id = remoteRow?.selected_offer_id || null;
    if (!offer.product_id && remoteRow?.custom_name) {
      active.custom_name = remoteRow.custom_name;
      active.name = remoteRow.custom_name;
    }
    active.updated_at = remoteRow?.updated_at || new Date().toISOString();

    const normalized = rows.filter((row) => row === active || row?.key !== key);
    api.writeList?.(normalized);
  }

  const normalizeRecipeName = (value) => String(value || '').trim().toLocaleLowerCase('cs-CZ');
  const normalizeRecipeKey = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function parseRecipeIngredient(value) {
    const match = String(value || '').trim().match(/^(.*?)\s*\(\s*([0-9]+(?:[.,][0-9]+)?)\s+(kg|g|ml|l|ks|balení|stroužky)\s*\)\s*$/i);
    if (!match) return null;
    const amount = Number(match[2].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      base: match[1].trim(),
      amount,
      unit: match[3].toLocaleLowerCase('cs-CZ')
    };
  }

  function formatRecipeAmount(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3))).replace('.', ',');
  }

  function consolidateRecipeRows(sourceRows) {
    const rows = Array.isArray(sourceRows) ? sourceRows : [];
    const groups = new Map();
    rows.forEach((row) => {
      if (row?.source !== 'recipe' || row?.completed || row?.is_completed || row?.product_id) return;
      const parsed = parseRecipeIngredient(row.custom_name || row.name);
      if (!parsed) return;
      const key = `${normalizeRecipeKey(parsed.base)}|${normalizeRecipeKey(parsed.unit)}`;
      const group = groups.get(key) || [];
      group.push({ row, parsed });
      groups.set(key, group);
    });

    const removed = new Set();
    let merged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const synced = group.filter(({ row }) => row.server_id);
      if (synced.length > 1) continue;
      const canonical = synced[0] || group[0];
      const total = group.reduce((sum, entry) => sum + entry.parsed.amount, 0);
      const newName = `${canonical.parsed.base} (${formatRecipeAmount(total)} ${canonical.parsed.unit})`;
      const oldName = String(canonical.row.custom_name || canonical.row.name || '').trim();

      canonical.row.custom_name = newName;
      canonical.row.name = newName;
      canonical.row.key = `c:${normalizeRecipeKey(newName)}`;
      canonical.row.quantity = 1;
      canonical.row.qty = 1;
      canonical.row.unit = 'ks';
      canonical.row.source = 'recipe';
      canonical.row.recipe_ids = [...new Set(group.flatMap(({ row }) => [row.recipe_id, ...(Array.isArray(row.recipe_ids) ? row.recipe_ids : [])]).filter(Boolean))];
      canonical.row.updated_at = new Date().toISOString();
      if (canonical.row.server_id && normalizeRecipeName(oldName) !== normalizeRecipeName(newName)) canonical.row.recipe_dirty = true;

      for (const entry of group) {
        if (entry.row === canonical.row) continue;
        removed.add(entry.row);
        merged += 1;
      }
    }

    return { rows: removed.size ? rows.filter((row) => !removed.has(row)) : rows, merged };
  }

  function createMutationId() {
    const source = globalThis.crypto;
    if (source?.randomUUID) return source.randomUUID();
    if (!source?.getRandomValues) throw new Error('Prohlížeč neumí bezpečně vytvořit identifikátor změny.');
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function findOwnerList(db, userId) {
    const { data, error } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.id || null;
  }

  async function loadRemoteRecipeMap(db, listId) {
    if (!listId) return new Map();
    const { data, error } = await db.from('shopping_list_items')
      .select('id,custom_name,quantity,unit,is_completed,updated_at')
      .eq('shopping_list_id', listId)
      .is('product_id', null)
      .order('created_at');
    if (error) throw error;
    const map = new Map();
    for (const row of data || []) {
      if (row?.is_completed) continue;
      const key = normalizeRecipeName(row?.custom_name);
      if (key && !map.has(key)) map.set(key, row);
    }
    return map;
  }

  function alignRecipeRow(row, remote) {
    if (!row || !remote?.id) return;
    row.server_id = remote.id;
    row.selected_offer_id = null;
    row.quantity = 1;
    row.qty = 1;
    row.unit = 'ks';
    row.completed = false;
    row.is_completed = false;
    row.updated_at = remote.updated_at || new Date().toISOString();
    delete row.recipe_dirty;
  }

  async function syncPendingRecipeRows() {
    const api = await publicApi();
    const consolidated = consolidateRecipeRows(api.readList?.() || []);
    const rows = consolidated.rows;
    if (consolidated.merged > 0) api.writeList?.(rows);

    const db = await api.getSupabase();
    if (!db) return { synced:0, localOnly:true, merged:consolidated.merged };

    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;
    if (!session?.user?.id) return { synced:0, localOnly:true, merged:consolidated.merged };

    const dirty = rows.filter((row) => (
      row?.source === 'recipe'
      && row?.server_id
      && row?.recipe_dirty
      && !row?.completed
      && String(row?.custom_name || row?.name || '').trim()
    ));
    const pending = rows.filter((row) => (
      row?.source === 'recipe'
      && !row?.server_id
      && !row?.completed
      && String(row?.custom_name || row?.name || '').trim()
    ));
    if (!pending.length && !dirty.length) return { synced:0, localOnly:false, merged:consolidated.merged };

    let listId = await findOwnerList(db, session.user.id);
    const remoteMap = await loadRemoteRecipeMap(db, listId);
    let synced = 0;

    for (const row of dirty) {
      if (!listId) throw new Error('Aktivní nákupní seznam pro synchronizovaný recept nebyl nalezen.');
      const name = String(row.custom_name || row.name || '').trim();
      const { data: updated, error: updateError } = await db.from('shopping_list_items')
        .update({ custom_name:name, quantity:1, unit:'ks', is_completed:false })
        .eq('id', row.server_id)
        .eq('shopping_list_id', listId)
        .is('product_id', null)
        .select('id,custom_name,quantity,unit,is_completed,updated_at')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated?.id) throw new Error('Synchronizace sloučené receptové suroviny nebyla potvrzena.');
      alignRecipeRow(row, updated);
      remoteMap.set(normalizeRecipeName(name), updated);
      synced += 1;
    }

    for (const row of pending) {
      const name = String(row.custom_name || row.name || '').trim();
      const key = normalizeRecipeName(name);
      let remote = remoteMap.get(key) || null;

      if (!remote) {
        const { data: sync, error: syncError } = await db.rpc('add_own_shopping_list_custom_item', {
          p_custom_name: name,
          p_quantity: 1,
          p_unit: 'ks',
          p_mutation_id: createMutationId(),
        });
        if (syncError) throw syncError;
        remote = sync?.item || null;
        if (!remote?.id) throw new Error('Synchronizace receptu nepotvrdila přidanou surovinu.');
        listId = sync?.list_id || listId;
        remoteMap.set(key, remote);
      }

      alignRecipeRow(row, remote);
      synced += 1;
    }

    api.writeList?.(rows);
    return { synced, localOnly:false, merged:consolidated.merged };
  }

  function runOriginalRecipeAdd(button) {
    recipeBypass = true;
    try {
      button.click();
    } finally {
      recipeBypass = false;
    }
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

    const { data: sync, error: syncError } = await db.rpc('increment_own_shopping_list_offer', {
      p_offer_id: offerId
    });
    if (syncError) throw syncError;
    const remoteRow = sync?.item || null;
    if (!remoteRow?.id) {
      throw new Error('Synchronizace nákupního seznamu nepotvrdila přidanou položku.');
    }

    alignLocalRow(api, offer, remoteRow);
    feedback(button, 'Produkt byl přidán a synchronizován s účtem.');
  }

  document.addEventListener('click', (event) => {
    if (recipeBypass) return;
    const button = event.target?.closest?.('#recipesSection [data-recipe]');
    if (!button || button.disabled || recipeSyncing.has(button)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    // Zachovej přesně původní local-first recipe handler a jeho feedback.
    runOriginalRecipeAdd(button);
    recipeSyncing.add(button);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    recipeQueue = recipeQueue
      .catch(() => {})
      .then(() => syncPendingRecipeRows())
      .then((result) => {
        if (result?.localOnly) {
          const mergeText = result?.merged > 0 ? ` ${result.merged} duplicitních surovin bylo sloučeno.` : '';
          window.SlevaoPublic?.toast?.(`Recept je uložen v tomto zařízení.${mergeText} Po přihlášení se synchronizuje se seznamem.`);
        } else if (result?.synced > 0) {
          const mergeText = result?.merged > 0 ? `, ${result.merged} duplicitních surovin sloučeno` : '';
          window.SlevaoPublic?.toast?.(`Recept je uložen a ${result.synced} surovin je synchronizováno s účtem${mergeText}.`);
        }
      })
      .catch((error) => {
        console.debug('slevao_recipe_account_sync_failed', error);
        window.SlevaoPublic?.toast?.('Recept je uložen v tomto zařízení. Synchronizace účtu se dokončí po otevření seznamu.');
      })
      .finally(() => {
        recipeSyncing.delete(button);
        if (button.isConnected) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      });
  }, true);

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
  window.__slevaoRecipeAccountShoppingListSync = true;
})();
