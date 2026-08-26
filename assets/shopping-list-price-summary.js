(() => {
  'use strict';
  const list = document.getElementById('listItems');
  const optimizer = document.getElementById('optimizer');
  if (!list || !optimizer) return;

  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseMoney = (value) => Number(String(value || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';

  function absolutePriceMap() {
    const boxes = [...optimizer.querySelectorAll('.sfResultBox')];
    const absolute = boxes.find((box) => normalize(box.querySelector('h3')?.textContent) === 'absolutne nejnizsi cena') || boxes[1];
    const map = new Map();
    absolute?.querySelectorAll('.sfStoreTag[title]').forEach((tag) => {
      String(tag.getAttribute('title') || '').split('\n').forEach((line) => {
        const match = line.match(/^(.*?)\s+[–-]\s+([\d\s,.]+)\s*Kč\s*$/i);
        if (match) map.set(normalize(match[1]), parseMoney(match[2]));
      });
    });
    return map;
  }

  function renderPrices() {
    const prices = absolutePriceMap();
    let total = 0;
    let pricedCount = 0;
    const articles = [...list.querySelectorAll('.sfListItem:not(.done)')];
    articles.forEach((article) => {
      article.querySelector('.sfItemPrice')?.remove();
      const name = article.querySelector('.sfItemName')?.textContent || '';
      const subtotal = prices.get(normalize(name));
      if (!(subtotal > 0)) return;
      total += subtotal;
      pricedCount += 1;
      const price = document.createElement('div');
      price.className = 'sfItemPrice';
      price.textContent = money(subtotal);
      const remove = article.querySelector('[data-delete]');
      article.insertBefore(price, remove || null);
    });

    let summary = document.getElementById('listPriceSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'listPriceSummary';
      summary.className = 'listPriceSummary';
      list.insertAdjacentElement('afterend', summary);
    }
    if (!pricedCount) {
      summary.hidden = true;
      return;
    }
    summary.hidden = false;
    summary.innerHTML = `<span><b>Celkem</b><small>${pricedCount === articles.length ? ` za ${articles.length} položek` : ` · cena nalezena u ${pricedCount} z ${articles.length}`}</small></span><strong>${money(total)}</strong>`;
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderPrices(); });
  };
  new MutationObserver(schedule).observe(list, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(optimizer, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  schedule();
})();