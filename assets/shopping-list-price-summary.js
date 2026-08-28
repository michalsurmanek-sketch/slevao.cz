(() => {
  'use strict';
  const list = document.getElementById('listItems');
  const optimizer = document.getElementById('optimizer');
  if (!list || !optimizer) return;

  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseMoney = (value) => Number(String(value || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
  const itemLabel = (count) => count === 1 ? 'položku' : (count >= 2 && count <= 4 ? 'položky' : 'položek');

  function absoluteBox() {
    const boxes = [...optimizer.querySelectorAll('.sfResultBox')];
    return boxes.find((box) => normalize(box.querySelector('h3')?.textContent) === 'absolutne nejnizsi cena') || boxes[1] || null;
  }

  function boxUsesUpcomingPrice(box) {
    const note = normalize(box?.querySelector('.sfMuted')?.textContent);
    return note.includes('pouziva akci zacinajici');
  }

  function markUpcomingPlans() {
    let absoluteUpcoming = false;
    const absolute = absoluteBox();
    optimizer.querySelectorAll('.sfResultBox').forEach((box) => {
      const upcoming = boxUsesUpcomingPrice(box);
      box.classList.toggle('hasUpcomingPrice', upcoming);
      if (box === absolute && upcoming) absoluteUpcoming = true;
    });
    return absoluteUpcoming;
  }

  function absolutePriceBuckets() {
    const absolute = absoluteBox();
    const map = new Map();
    absolute?.querySelectorAll('.sfStoreTag[title]').forEach((tag) => {
      String(tag.getAttribute('title') || '').split('\n').forEach((line) => {
        const match = line.match(/^(.*?)\s+[–-]\s+([\d\s,.]+)\s*Kč\s*$/i);
        if (!match) return;
        const key = normalize(match[1]);
        const subtotal = parseMoney(match[2]);
        if (!key || subtotal <= 0) return;
        const bucket = map.get(key) || [];
        bucket.push(subtotal);
        map.set(key, bucket);
      });
    });
    return map;
  }

  function quantityOf(article) {
    const value = Number(article.querySelector('[data-quantity]')?.value || 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function renderPrices() {
    const absoluteUpcoming = markUpcomingPlans();
    const prices = absolutePriceBuckets();
    let total = 0;
    let pricedCount = 0;
    const articles = [...list.querySelectorAll('.sfListItem:not(.done)')];

    articles.forEach((article) => {
      article.querySelector('.sfItemPrice')?.remove();
      const name = article.querySelector('.sfItemName')?.textContent || '';
      const bucket = prices.get(normalize(name)) || [];
      const subtotal = Number(bucket.shift() || 0);
      const qty = quantityOf(article);
      const price = document.createElement('div');
      price.className = 'sfItemPrice';

      if (subtotal > 0) {
        total += subtotal;
        pricedCount += 1;
        const unit = qty > 1 ? subtotal / qty : 0;
        price.innerHTML = `<strong>${money(subtotal)}</strong>${qty > 1 ? `<small>${money(unit)} / ks</small>` : ''}`;
      } else {
        price.classList.add('missing');
        price.innerHTML = '<strong>Cena<br>nenalezena</strong>';
      }

      article.appendChild(price);
    });

    let summary = document.getElementById('listPriceSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'listPriceSummary';
      summary.className = 'listPriceSummary';
      list.insertAdjacentElement('afterend', summary);
    }

    if (!articles.length) {
      summary.hidden = true;
      return;
    }

    summary.hidden = false;
    const complete = pricedCount === articles.length;
    const coverage = complete ? `za ${articles.length} ${itemLabel(articles.length)}` : `cena nalezena u ${pricedCount} z ${articles.length}`;
    const timing = absoluteUpcoming ? ' · část cen začne během 7 dnů' : '';
    summary.innerHTML = `<span><b>Celkem</b><small>${coverage}${timing}</small></span><strong>${pricedCount ? money(total) : '—'}</strong>`;
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderPrices(); });
  };

  new MutationObserver(schedule).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
  new MutationObserver(schedule).observe(optimizer, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  list.addEventListener('change', schedule);
  schedule();
})();