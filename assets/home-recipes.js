(() => {
  'use strict';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const RECIPES = {
    spagety: ['Špagety (1 balení)','Mleté hovězí maso (500 g)','Rajčatové pyré (1 ks)','Cibule (1 ks)','Česnek (2 stroužky)','Mrkev (1 ks)','Parmazán (1 balení)','Olivový olej (1 ks)'],
    rizek: ['Kuřecí prsa (600 g)','Hladká mouka (1 balení)','Vejce (3 ks)','Strouhanka (1 balení)','Olej na smažení (1 ks)','Brambory (1 kg)'],
    gulas: ['Hovězí maso (800 g)','Cibule (4 ks)','Sádlo (1 ks)','Sladká paprika (1 balení)','Česnek (3 stroužky)','Kmín (1 balení)','Majoránka (1 balení)','Hovězí vývar (1 l)'],
    palacinky: ['Hladká mouka (250 g)','Mléko (500 ml)','Vejce (2 ks)','Olej (1 ks)','Marmeláda (1 ks)']
  };
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const readList = () => { try { const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const legacyRecipeNames = new Set(['Špagety','Mleté hovězí maso','Rajčatové pyré','Cibule','Česnek','Mrkev','Parmazán','Olivový olej','Kuřecí prsa','Hladká mouka','Vejce','Strouhanka','Olej na smažení','Brambory','Hovězí maso','Sádlo','Sladká paprika','Kmín','Majoránka','Hovězí vývar','Mléko','Olej','Marmeláda'].map(normalize));
  function migrateLegacyRecipeRows() {
    const rows = readList(); let changed = false;
    rows.forEach((row) => {
      const oldName = String(row.custom_name || row.name || '').trim();
      if (row.product_id || !legacyRecipeNames.has(normalize(oldName)) || !Number(row.quantity)) return;
      const amount = `${Number(row.quantity).toLocaleString('cs-CZ')} ${String(row.unit || 'ks').trim()}`;
      const name = `${oldName} (${amount})`;
      row.custom_name = name; row.name = name; row.key = `c:${normalize(name)}`; row.quantity = 1; row.unit = 'ks'; changed = true;
    });
    if (changed) try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch {}
  }
  function addRecipe(key, button) {
    const ingredients = RECIPES[key]; if (!ingredients) return;
    const rows = readList(); let added = 0;
    ingredients.forEach((name) => {
      if (rows.some((row) => !row.completed && normalize(row.custom_name || row.name) === normalize(name))) return;
      rows.push({local_id:uid(),key:`c:${normalize(name)}`,product_id:null,selected_offer_id:null,custom_name:name,name,quantity:1,unit:'ks',completed:false,added_at:new Date().toISOString()}); added += 1;
    });
    try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch { return; }
    window.SlevaoPublic?.updateNavCount?.();
    const original = button.textContent; button.textContent = added ? `Přidáno ${added} surovin ✓` : 'Už je v seznamu ✓'; button.classList.add('is-added');
    window.setTimeout(() => { button.textContent = original; button.classList.remove('is-added'); }, 2400);
  }
  migrateLegacyRecipeRows();
  document.querySelectorAll('#recipesSection [data-recipe]').forEach((button) => button.addEventListener('click', () => addRecipe(button.dataset.recipe, button)));
})();
