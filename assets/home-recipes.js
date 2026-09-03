(() => {
  'use strict';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const RECIPES = {
    spagety: [['Špagety',1,'balení'],['Mleté hovězí maso',500,'g'],['Rajčatové pyré',1,'ks'],['Cibule',1,'ks'],['Česnek',2,'stroužky'],['Mrkev',1,'ks'],['Parmazán',1,'balení'],['Olivový olej',1,'ks']],
    rizek: [['Kuřecí prsa',600,'g'],['Hladká mouka',1,'balení'],['Vejce',3,'ks'],['Strouhanka',1,'balení'],['Olej na smažení',1,'ks'],['Brambory',1,'kg']],
    gulas: [['Hovězí maso',800,'g'],['Cibule',4,'ks'],['Sádlo',1,'ks'],['Sladká paprika',1,'balení'],['Česnek',3,'stroužky'],['Kmín',1,'balení'],['Majoránka',1,'balení'],['Hovězí vývar',1,'l']],
    palacinky: [['Hladká mouka',250,'g'],['Mléko',500,'ml'],['Vejce',2,'ks'],['Olej',1,'ks'],['Marmeláda',1,'ks']]
  };
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const readList = () => { try { const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  function addRecipe(key, button) {
    const ingredients = RECIPES[key]; if (!ingredients) return;
    const rows = readList(); let added = 0;
    ingredients.forEach(([name, quantity, unit]) => {
      if (rows.some((row) => !row.completed && normalize(row.custom_name || row.name) === normalize(name))) return;
      rows.push({local_id:uid(),key:`c:${normalize(name)}`,product_id:null,selected_offer_id:null,custom_name:name,name,quantity,unit,completed:false,added_at:new Date().toISOString()}); added += 1;
    });
    try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch { return; }
    window.SlevaoPublic?.updateNavCount?.();
    const original = button.textContent; button.textContent = added ? `Přidáno ${added} surovin ✓` : 'Už je v seznamu ✓'; button.classList.add('is-added');
    window.setTimeout(() => { button.textContent = original; button.classList.remove('is-added'); }, 2400);
  }
  document.querySelectorAll('#recipesSection [data-recipe]').forEach((button) => button.addEventListener('click', () => addRecipe(button.dataset.recipe, button)));
})();
