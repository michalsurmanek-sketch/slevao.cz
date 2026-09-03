(() => {
  'use strict';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const list = document.getElementById('listItems');
  const optimizer = document.getElementById('optimizer');
  if (!list || !optimizer) return;

  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseMoney = (value) => Number(String(value || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
  const itemLabel = (count) => count === 1 ? 'položku' : (count >= 2 && count <= 4 ? 'položky' : 'položek');
  const safeUnit = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    return /^[a-z0-9á-ž.%/-]{1,12}$/i.test(raw) ? raw : '';
  };

  function pragueDate(value = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'
    }).format(value);
  }

  function absoluteBox() {
    const precise = optimizer.querySelector('[data-day-consistent-plan="true"]');
    if (precise) return precise;
    const boxes = [...optimizer.querySelectorAll('.sfResultBox')];
    return boxes.find((box) => normalize(box.querySelector('h3')?.textContent) === 'absolutne nejnizsi cena') || boxes[1] || null;
  }

  function boxUsesUpcomingPrice(box) {
    const note = normalize(box?.querySelector('.sfMuted')?.textContent);
    return note.includes('pouziva akci zacinajici');
  }

  function futureDayLabel(box) {
    const dateNode = box?.querySelector('.sfDayPlanDate[data-plan-date]');
    const dateKey = String(dateNode?.dataset?.planDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey <= pragueDate()) return '';
    return String(dateNode?.textContent || '').trim();
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

  function localUnitMap() {
    const map = new Map();
    if (sharedMode) return map;
    try {
      const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      if (!Array.isArray(rows)) return map;
      rows.forEach((row) => {
        const unit = safeUnit(row?.unit);
        if (!unit) return;
        const localId = String(row?.local_id || '').trim();
        const serverId = String(row?.server_id || '').trim();
        if (localId) map.set(localId, unit);
        if (serverId) map.set(serverId, unit);
      });
    } catch {}
    return map;
  }

  function quantityOf(article) {
    const value = Number(article.querySelector('[data-quantity]')?.value || 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function unitLabel(article, units) {
    const quantityInput = article.querySelector('[data-quantity]');
    const direct = safeUnit(quantityInput?.dataset?.unit || article?.dataset?.unit || '');
    if (direct) return direct;
    return safeUnit(units?.get(String(article?.dataset?.id || '').trim()) || '');
  }

  function syncPriceNode(article, className, html) {
    let price = article.querySelector('.sfItemPrice');
    if (!price) {
      price = document.createElement('div');
      article.appendChild(price);
    }
    if (price.className !== className) price.className = className;
    if (price.innerHTML !== html) price.innerHTML = html;
  }

  function ambiguousPriceKeys(articles, prices) {
    const counts = new Map();
    articles.forEach((article) => {
      const key = normalize(article.querySelector('.sfItemName')?.textContent || '');
      if (key) counts.set(key, Number(counts.get(key) || 0) + 1);
    });
    const ambiguous = new Set();
    counts.forEach((count, key) => {
      if (count <= 1) return;
      const values = prices.get(key) || [];
      const distinct = new Set(values.map((value) => Number(value).toFixed(2)));
      if (values.length !== count || distinct.size > 1) ambiguous.add(key);
    });
    return ambiguous;
  }

  function renderPrices() {
    const absolute = absoluteBox();
    const futureTiming = futureDayLabel(absolute);
    const absoluteUpcoming = markUpcomingPlans();
    const prices = absolutePriceBuckets();
    const units = localUnitMap();
    let total = 0;
    let pricedCount = 0;
    const articles = [...list.querySelectorAll('.sfListItem:not(.done)')];
    const ambiguousKeys = ambiguousPriceKeys(articles, prices);

    articles.forEach((article) => {
      const name = article.querySelector('.sfItemName')?.textContent || '';
      const key = normalize(name);
      const bucket = prices.get(key) || [];
      const subtotal = Number(bucket.shift() || 0);
      const qty = quantityOf(article);

      if (subtotal > 0) {
        total += subtotal;
        pricedCount += 1;
      }

      if (ambiguousKeys.has(key)) {
        syncPriceNode(article, 'sfItemPrice missing', '<strong>Viz<br>souhrn</strong>');
      } else if (subtotal > 0) {
        const unit = qty > 1 ? subtotal / qty : 0;
        const label = unitLabel(article, units);
        syncPriceNode(
          article,
          'sfItemPrice',
          `<strong>${money(subtotal)}</strong>${qty > 1 && label ? `<small>${money(unit)} / ${label}</small>` : ''}`
        );
      } else {
        syncPriceNode(article, 'sfItemPrice missing', '<strong>Cena<br>nenalezena</strong>');
      }
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
    const summaryLabel = complete ? 'Celkem' : 'Mezisoučet';
    const coverage = complete ? `za ${articles.length} ${itemLabel(articles.length)}` : `cena nalezena u ${pricedCount} z ${articles.length}`;
    const timing = futureTiming ? ` · ${futureTiming}` : (absoluteUpcoming ? ' · ceny nemusí platit ve stejný den' : '');
    const ambiguity = ambiguousKeys.size ? ' · stejné názvy bez rozpisu' : '';
    const summaryHtml = `<span><b>${summaryLabel}</b><small>${coverage}${timing}${ambiguity}</small></span><strong>${pricedCount ? money(total) : '—'}</strong>`;
    if (summary.innerHTML !== summaryHtml) summary.innerHTML = summaryHtml;
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderPrices(); });
  };

  new MutationObserver(schedule).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'data-unit'] });
  new MutationObserver(schedule).observe(optimizer, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-plan-date'] });
  list.addEventListener('change', schedule);
  schedule();
})();