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

  function normalizeRecipeUnit(value) {
    const unit = String(value || '').trim().toLocaleLowerCase('cs-CZ');
    return ['stroužek','stroužky','stroužků'].includes(unit) ? 'stroužky' : unit;
  }

  function parseRecipeIngredient(value) {
    const match = String(value || '').trim().match(/^(.*?)\s*\(\s*([0-9]+(?:[.,][0-9]+)?)\s+(kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků)\s*\)\s*$/i);
    if (!match) return null;
    const amount = Number(match[2].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      base: match[1].trim(),
      amount,
      unit: normalizeRecipeUnit(match[3])
    };
  }

  function formatRecipeAmount(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3))).replace('.', ',');
  }

  function formatRecipeUnit(unit, amount) {
    if (unit !== 'stroužky') return unit;
    const count = Number(amount);
    if (count === 1) return 'stroužek';
    if (Number.isInteger(count) && count >= 2 && count <= 4) return 'stroužky';
    return 'stroužků';
  }

  function recipeSources(row) {
    return [...new Set([row?.recipe_id, ...(Array.isArray(row?.recipe_ids) ? row.recipe_ids : [])].filter(Boolean))];
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
      const sourceIds = new Set(recipeSources(canonical.row));
      let total = canonical.parsed.amount;
      let safe = true;

      for (const entry of group) {
        if (entry.row === canonical.row) continue;
        const entrySources = recipeSources(entry.row);
        const overlap = entrySources.filter((id) => sourceIds.has(id));
        if (overlap.length && overlap.length !== entrySources.length) {
          safe = false;
          break;
        }
        const duplicateRecipe = entrySources.length > 0 && overlap.length === entrySources.length;
        if (!duplicateRecipe) {
          total += entry.parsed.amount;
          entrySources.forEach((id) => sourceIds.add(id));
        }
      }
      if (!safe) continue;

      const displayUnit = formatRecipeUnit(canonical.parsed.unit, total);
      const newName = `${canonical.parsed.base} (${formatRecipeAmount(total)} ${displayUnit})`;
      const oldName = String(canonical.row.custom_name || canonical.row.name || '').trim();

      canonical.row.custom_name = newName;
      canonical.row.name = newName;
      canonical.row.key = `c:${normalizeRecipeKey(newName)}`;
      canonical.row.quantity = 1;
      canonical.row.qty = 1;
      canonical.row.unit = 'ks';
      canonical.row.source = 'recipe';
      canonical.row.recipe_ids = [...sourceIds];
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

  function alignRecipeRow(row, remote) {
    if (!row || !remote?.id) return;
    row.server_id = remote.id;
    row.selected_offer_id = null;
    row.quantity = 1;
    row.qty = 1;
    row.unit = 'ks';
    row.completed = false;
    row.is_completed = false;
    row.source = 'recipe';
    if (Array.isArray(remote.recipe_ids) && remote.recipe_ids.length) row.recipe_ids = remote.recipe_ids;
    row.updated_at = remote.updated_at || new Date().toISOString();
    delete row.recipe_dirty;
  }

  async function syncRecipeRow(db, row) {
    const name = String(row?.custom_name || row?.name || '').trim();
    if (!name) return { synced:false, conflict:false };

    const { data: sync, error: syncError } = await db.rpc('sync_own_shopping_list_recipe_item', {
      p_source_item_id: row?.server_id || null,
      p_custom_name: name,
      p_recipe_ids: recipeSources(row),
    });
    if (syncError) throw syncError;

    if (sync?.status === 'conflict') {
      return { synced:false, conflict:true, reason:sync?.reason || 'recipe_conflict' };
    }

    const remote = sync?.item || null;
    if (!remote?.id) throw new Error('Synchronizace receptu nepotvrdila receptovou položku.');
    alignRecipeRow(row, remote);
    return { synced:true, conflict:false, status:sync?.status || 'updated' };
  }

  async function syncPendingRecipeRows() {
    const api = await publicApi();
    const consolidated = consolidateRecipeRows(api.readList?.() || []);
    const rows = consolidated.rows;
    if (consolidated.merged > 0) api.writeList?.(rows);

    const db = await api.getSupabase();
    if (!db) return { synced:0, conflicts:0, localOnly:true, merged:consolidated.merged };

    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;
    if (!session?.user?.id) return { synced:0, conflicts:0, localOnly:true, merged:consolidated.merged };

    const candidates = rows.filter((row) => (
      row?.source === 'recipe'
      && !row?.completed
      && !row?.is_completed
      && String(row?.custom_name || row?.name || '').trim()
      && (!row?.server_id || row?.recipe_dirty)
    ));
    if (!candidates.length) return { synced:0, conflicts:0, localOnly:false, merged:consolidated.merged };

    let synced = 0;
    let conflicts = 0;
    for (const row of candidates) {
      const result = await syncRecipeRow(db, row);
      if (result.conflict) {
        conflicts += 1;
        continue;
      }
      if (result.synced) {
        synced += 1;
        api.writeList?.(rows);
      }
    }

    api.writeList?.(rows);
    return { synced, conflicts, localOnly:false, merged:consolidated.merged };
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
        } else if (result?.synced > 0 || result?.conflicts > 0) {
          const mergeText = result?.merged > 0 ? `, ${result.merged} duplicitních surovin sloučeno` : '';
          const conflictText = result?.conflicts > 0 ? `; ${result.conflicts} nejasných konfliktů ponecháno beze změny` : '';
          window.SlevaoPublic?.toast?.(`Recept je uložen a ${result.synced} surovin je synchronizováno s účtem${mergeText}${conflictText}.`);
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