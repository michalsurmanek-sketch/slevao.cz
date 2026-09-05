(() => {
  'use strict';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const LEGACY_RECIPE_START = Date.parse('2026-09-03T08:15:00Z');
  const LEGACY_RECIPE_END = Date.parse('2026-09-03T09:00:00Z');
  const RECIPES = {
    spagety: ['Špagety (1 balení)','Mleté hovězí maso (500 g)','Rajčatové pyré (1 ks)','Cibule (1 ks)','Česnek (2 stroužky)','Mrkev (1 ks)','Parmazán (1 balení)','Olivový olej (1 ks)'],
    rizek: ['Kuřecí prsa (600 g)','Hladká mouka (1 balení)','Vejce (3 ks)','Strouhanka (1 balení)','Olej na smažení (1 ks)','Brambory (1 kg)'],
    gulas: ['Hovězí maso (800 g)','Cibule (4 ks)','Sádlo (1 ks)','Sladká paprika (1 balení)','Česnek (3 stroužky)','Kmín (1 balení)','Majoránka (1 balení)','Hovězí vývar (1 l)'],
    palacinky: ['Hladká mouka (250 g)','Mléko (500 ml)','Vejce (2 ks)','Olej (1 ks)','Marmeláda (1 ks)']
  };
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const readList = () => { try { const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const recipeSources = (row) => [...new Set([
    row?.recipe_id,
    ...(Array.isArray(row?.recipe_ids) ? row.recipe_ids : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  const isRecipeRow = (row) => Boolean(row && (row.source === 'recipe' || row.recipe_id || recipeSources(row).length));
  const legacyRecipeRows = new Map([
    ['Špagety',1,'balení','Špagety (1 balení)'],['Mleté hovězí maso',500,'g','Mleté hovězí maso (500 g)'],['Rajčatové pyré',1,'ks','Rajčatové pyré (1 ks)'],['Cibule',1,'ks','Cibule (1 ks)'],['Česnek',2,'stroužky','Česnek (2 stroužky)'],['Mrkev',1,'ks','Mrkev (1 ks)'],['Parmazán',1,'balení','Parmazán (1 balení)'],['Olivový olej',1,'ks','Olivový olej (1 ks)'],
    ['Kuřecí prsa',600,'g','Kuřecí prsa (600 g)'],['Hladká mouka',1,'balení','Hladká mouka (1 balení)'],['Vejce',3,'ks','Vejce (3 ks)'],['Strouhanka',1,'balení','Strouhanka (1 balení)'],['Olej na smažení',1,'ks','Olej na smažení (1 ks)'],['Brambory',1,'kg','Brambory (1 kg)'],
    ['Hovězí maso',800,'g','Hovězí maso (800 g)'],['Cibule',4,'ks','Cibule (4 ks)'],['Sádlo',1,'ks','Sádlo (1 ks)'],['Sladká paprika',1,'balení','Sladká paprika (1 balení)'],['Česnek',3,'stroužky','Česnek (3 stroužky)'],['Kmín',1,'balení','Kmín (1 balení)'],['Majoránka',1,'balení','Majoránka (1 balení)'],['Hovězí vývar',1,'l','Hovězí vývar (1 l)'],
    ['Hladká mouka',250,'g','Hladká mouka (250 g)'],['Mléko',500,'ml','Mléko (500 ml)'],['Vejce',2,'ks','Vejce (2 ks)'],['Olej',1,'ks','Olej (1 ks)'],['Marmeláda',1,'ks','Marmeláda (1 ks)']
  ].map(([name, quantity, unit, fixedName]) => [`${normalize(name)}|${quantity}|${normalize(unit)}`, fixedName]));

  function isLegacyRecipeTimestamp(row) {
    const timestamp = Date.parse(String(row?.added_at || row?.created_at || ''));
    return Number.isFinite(timestamp) && timestamp >= LEGACY_RECIPE_START && timestamp < LEGACY_RECIPE_END;
  }

  function migrateLegacyRecipeRows() {
    const rows = readList(); let changed = false;
    rows.forEach((row) => {
      if (!row || row.product_id || !isLegacyRecipeTimestamp(row)) return;
      const oldName = String(row.custom_name || row.name || '').trim();
      const quantity = Number(row.quantity);
      const unit = String(row.unit || 'ks').trim();
      if (!oldName || !Number.isFinite(quantity) || quantity <= 0) return;
      const fixedName = legacyRecipeRows.get(`${normalize(oldName)}|${quantity}|${normalize(unit)}`);
      if (!fixedName) return;
      row.custom_name = fixedName;
      row.name = fixedName;
      row.key = `c:${normalize(fixedName)}`;
      row.quantity = 1;
      row.qty = 1;
      row.unit = 'ks';
      row.source = 'recipe';
      row.updated_at = new Date().toISOString();
      changed = true;
    });
    if (changed) try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch {}
  }

  function mergeRecipeProvenance(row, recipeKey) {
    if (!isRecipeRow(row)) return false;
    const before = recipeSources(row);
    const next = [...new Set([...before, String(recipeKey || '').trim()].filter(Boolean))];
    if (next.length === before.length && next.every((value, index) => value === before[index])) return false;
    row.source = 'recipe';
    row.recipe_id = row.recipe_id || next[0] || recipeKey;
    row.recipe_ids = next;
    row.updated_at = new Date().toISOString();
    row.recipe_dirty = 1;
    delete row.recipe_cloud_synced;
    return true;
  }

  function addRecipe(key, button) {
    const ingredients = RECIPES[key]; if (!ingredients) return;
    const rows = readList(); let added = 0; let linked = 0;
    ingredients.forEach((name) => {
      const existing = rows.find((row) => (
        !row?.completed
        && !row?.is_completed
        && !row?.product_id
        && isRecipeRow(row)
        && normalize(row.custom_name || row.name) === normalize(name)
      ));
      if (existing) {
        if (mergeRecipeProvenance(existing, key)) linked += 1;
        return;
      }
      rows.push({local_id:uid(),key:`c:${normalize(name)}`,product_id:null,selected_offer_id:null,custom_name:name,name,quantity:1,qty:1,unit:'ks',completed:false,source:'recipe',recipe_id:key,recipe_ids:[key],added_at:new Date().toISOString()}); added += 1;
    });
    try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch { return; }
    window.SlevaoPublic?.updateNavCount?.();
    const original = button.textContent;
    button.textContent = added ? `Přidáno ${added} surovin ✓` : linked ? 'Recept propojen se seznamem ✓' : 'Už je v seznamu ✓';
    button.classList.add('is-added');
    window.setTimeout(() => { button.textContent = original; button.classList.remove('is-added'); }, 2400);
  }
  migrateLegacyRecipeRows();
  document.querySelectorAll('#recipesSection [data-recipe]').forEach((button) => button.addEventListener('click', () => addRecipe(button.dataset.recipe, button)));
})();
