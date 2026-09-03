(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const START = Date.parse('2026-09-03T08:15:00Z');
  const END = Date.parse('2026-09-03T09:00:00Z');
  const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const fixes = new Map([
    ['Špagety',1,'balení','Špagety (1 balení)'],['Mleté hovězí maso',500,'g','Mleté hovězí maso (500 g)'],['Rajčatové pyré',1,'ks','Rajčatové pyré (1 ks)'],['Cibule',1,'ks','Cibule (1 ks)'],['Česnek',2,'stroužky','Česnek (2 stroužky)'],['Mrkev',1,'ks','Mrkev (1 ks)'],['Parmazán',1,'balení','Parmazán (1 balení)'],['Olivový olej',1,'ks','Olivový olej (1 ks)'],
    ['Kuřecí prsa',600,'g','Kuřecí prsa (600 g)'],['Hladká mouka',1,'balení','Hladká mouka (1 balení)'],['Vejce',3,'ks','Vejce (3 ks)'],['Strouhanka',1,'balení','Strouhanka (1 balení)'],['Olej na smažení',1,'ks','Olej na smažení (1 ks)'],['Brambory',1,'kg','Brambory (1 kg)'],
    ['Hovězí maso',800,'g','Hovězí maso (800 g)'],['Cibule',4,'ks','Cibule (4 ks)'],['Sádlo',1,'ks','Sádlo (1 ks)'],['Sladká paprika',1,'balení','Sladká paprika (1 balení)'],['Česnek',3,'stroužky','Česnek (3 stroužky)'],['Kmín',1,'balení','Kmín (1 balení)'],['Majoránka',1,'balení','Majoránka (1 balení)'],['Hovězí vývar',1,'l','Hovězí vývar (1 l)'],
    ['Hladká mouka',250,'g','Hladká mouka (250 g)'],['Mléko',500,'ml','Mléko (500 ml)'],['Vejce',2,'ks','Vejce (2 ks)'],['Olej',1,'ks','Olej (1 ks)'],['Marmeláda',1,'ks','Marmeláda (1 ks)']
  ].map(([name, quantity, unit, fixedName]) => [`${norm(name)}|${quantity}|${norm(unit)}`, fixedName]));

  let rows;
  try {
    rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
  } catch {
    return;
  }
  if (!Array.isArray(rows) || !rows.length) return;

  let repaired = 0;
  rows.forEach((row) => {
    if (!row || row.product_id) return;
    const addedAt = Date.parse(String(row.added_at || row.created_at || ''));
    if (!Number.isFinite(addedAt) || addedAt < START || addedAt >= END) return;
    const quantity = Number(row.quantity);
    const name = String(row.custom_name || row.name || '').trim();
    const unit = String(row.unit || 'ks').trim();
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return;
    const fixedName = fixes.get(`${norm(name)}|${quantity}|${norm(unit)}`);
    if (!fixedName) return;
    row.custom_name = fixedName;
    row.name = fixedName;
    row.key = `c:${norm(fixedName)}`;
    row.quantity = 1;
    row.qty = 1;
    row.unit = 'ks';
    row.source = 'recipe';
    row.updated_at = new Date().toISOString();
    repaired += 1;
  });

  if (!repaired) return;
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
    window.__slevaoRecipeQuantityGuard = { repaired };
  } catch {}
})();
