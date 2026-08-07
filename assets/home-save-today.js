(() => {
  'use strict';

  const BRIEF_KEY = 'slevao-savings-brief-v1';
  const PAGE_SIZE = 1000;
  const TEMPLATES = {
    grill: {
      title: 'Grilování', icon: '🔥',
      defaultRequest: 'Grilování pro rodinu nebo přátele',
      items: [
        ['Kuřecí maso',['kureci','kure']],
        ['Vepřové na gril',['krkov','veprove']],
        ['Klobása',['klobas']],
        ['Pečivo',['rohlik','chleb','baget','peciv']],
        ['Paprika',['paprik']],
        ['Rajčata',['rajcat']],
        ['Nealko nápoj',['cola','limonad','dzus']],
        ['Voda',['voda']]
      ]
    },
    weekly: {
      title: 'Týdenní základ', icon: '🛒',
      defaultRequest: 'Základní týdenní nákup domácnosti',
      items: [
        ['Mléko',['mleko']],
        ['Vejce',['vejce']],
        ['Máslo',['maslo']],
        ['Sýr',['syr']],
        ['Pečivo',['rohlik','chleb','baget','peciv']],
        ['Kuřecí maso',['kureci','kure']],
        ['Brambory',['brambor']],
        ['Banány',['banan']],
        ['Rajčata',['rajcat']]
      ]
    },
    custom: { title:'Vlastní zadání', icon:'✦', defaultRequest:'', items:[] }
  };

  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const localDate = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

  let selected = 'grill';

  async function getApi(timeout = 5000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic;
    }
    throw new Error('Datové služby se ještě nenačetly.');
  }

  function saveBrief(modal) {
    const brief = {
      version: 1,
      scenario: selected,
      request: modal.querySelector('#sqSaveRequest').value.trim(),
      people: Math.max(1, Number(modal.querySelector('#sqSavePeople').value || 1)),
      budget: Math.max(0, Number(modal.querySelector('#sqSaveBudget').value || 0)),
      created_at: new Date().toISOString()
    };
    try { localStorage.setItem(BRIEF_KEY, JSON.stringify(brief)); } catch {}
    return brief;
  }

  async function loadCurrentOffers() {
    const api = await getApi();
    const db = await api.getSupabase();
    const today = localDate();
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db.from('offers')
        .select('id,product_id,store_id,title,price,old_price,image_url,valid_from,valid_to,products(id,name,brand,quantity_text,image_url),stores(id,name,slug)')
        .eq('status', 'published')
        .lte('valid_from', today)
        .gte('valid_to', today)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return rows;
  }

  function offerText(offer) {
    return fold([offer.title, offer.products?.name, offer.products?.brand, offer.products?.quantity_text].filter(Boolean).join(' '));
  }

  function selectTemplateOffers(template, offers) {
    const used = new Set();
    const selectedRows = [];
    const missing = [];
    template.items.forEach(([label, terms]) => {
      const candidates = offers.filter((offer) => {
        if (!offer.product_id || used.has(String(offer.product_id))) return false;
        const text = offerText(offer);
        return terms.some((term) => text.includes(fold(term)));
      }).sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
      const best = candidates[0];
      if (!best) { missing.push(label); return; }
      used.add(String(best.product_id));
      selectedRows.push({ label, offer: best });
    });
    return { selectedRows, missing };
  }

  function resultClass(total, budget) {
    if (!budget) return 'good';
    return total <= budget ? 'good' : 'warn';
  }

  async function runTemplate(modal, brief) {
    const result = modal.querySelector('#sqSaveResult');
    const action = modal.querySelector('#sqSaveAction');
    action.disabled = true;
    action.textContent = 'Hledám dnešní akce…';
    result.className = 'sqSaveResult';
    result.innerHTML = '<strong>Procházím právě platné nabídky</strong>Načítám ceny pouze po spuštění průvodce.';
    try {
      const api = await getApi();
      const offers = await loadCurrentOffers();
      const template = TEMPLATES[selected];
      const { selectedRows, missing } = selectTemplateOffers(template, offers);
      if (!selectedRows.length) throw new Error('Pro tuto šablonu dnes nebyly nalezeny propojené nabídky.');

      const currentList = api.readList?.() || [];
      const currentProducts = new Set(currentList.filter((row) => !row.completed && row.product_id).map((row) => String(row.product_id)));
      let added = 0;
      let already = 0;
      let total = 0;
      let reference = 0;
      selectedRows.forEach(({ offer }) => {
        const price = Number(offer.price || 0);
        const oldPrice = Number(offer.old_price || 0);
        total += price;
        reference += oldPrice > price ? oldPrice : price;
        if (currentProducts.has(String(offer.product_id))) { already++; return; }
        if (api.addItemFromOffer?.(offer)) {
          added++;
          currentProducts.add(String(offer.product_id));
        }
      });
      const savings = Math.max(0, reference - total);
      const budgetText = brief.budget
        ? (total <= brief.budget ? ` Základní košík je o ${money(brief.budget - total)} Kč pod zadaným rozpočtem.` : ` Základní košík je o ${money(total - brief.budget)} Kč nad zadaným rozpočtem.`)
        : '';
      result.className = `sqSaveResult ${resultClass(total, brief.budget)}`;
      result.innerHTML = `<strong>${template.title}: základní košík ${money(total)} Kč</strong>Doložená úspora z původních cen: ${money(savings)} Kč. Přidáno ${added} nových položek${already ? `, ${already} už v seznamu` : ''}.${missing.length ? ` Nenalezeno: ${missing.join(', ')}.` : ''}${budgetText}<br><small>Jde o transparentní šablonu po 1 balení nalezeného produktu, ne AI odhad množství pro ${brief.people} osob. Množství uprav v seznamu podle konkrétní gramáže.</small><br><a href="seznam.html">Otevřít a doladit nákupní seznam →</a>`;
    } catch (error) {
      result.className = 'sqSaveResult bad';
      result.innerHTML = `<strong>Košík se nepodařilo sestavit</strong>${String(error?.message || 'Zkus to znovu.')}`;
    } finally {
      action.disabled = false;
      action.textContent = 'Najít dnešní akce';
    }
  }

  function selectScenario(modal, key) {
    selected = key;
    modal.querySelectorAll('[data-sq-scenario]').forEach((button) => button.classList.toggle('active', button.dataset.sqScenario === key));
    const template = TEMPLATES[key];
    const request = modal.querySelector('#sqSaveRequest');
    if (!request.value.trim() || Object.values(TEMPLATES).some((item) => item.defaultRequest === request.value.trim())) request.value = template.defaultRequest;
    modal.querySelector('#sqSaveAction').textContent = key === 'custom' ? 'Uložit zadání' : 'Najít dnešní akce';
    modal.querySelector('#sqSaveResult').hidden = true;
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function openModal(modal) {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('#sqSaveRequest').focus();
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.className = 'sqSaveModal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="sqSaveBox" role="dialog" aria-modal="true" aria-labelledby="sqSaveTitle">
        <div class="sqSaveHead"><div><small>Chytrý nákup bez falešné AI</small><h2 id="sqSaveTitle">Ušetři mi dnes peníze</h2></div><button class="sqSaveClose" type="button" aria-label="Zavřít">×</button></div>
        <div class="sqSaveScenarios">
          <button class="sqSaveScenario active" type="button" data-sq-scenario="grill"><span>🔥</span>Grilování<small>Vybere dnešní akce pro základní grilovací košík.</small></button>
          <button class="sqSaveScenario" type="button" data-sq-scenario="weekly"><span>🛒</span>Týdenní základ<small>Najde běžné základní potraviny v dnešních akcích.</small></button>
          <button class="sqSaveScenario" type="button" data-sq-scenario="custom"><span>✦</span>Vlastní zadání<small>Uloží zadání pro budoucí chytrý planner bez vymyšlené odpovědi.</small></button>
        </div>
        <div class="sqSaveFields">
          <label class="sqSaveField full">Co plánuješ?<textarea id="sqSaveRequest" placeholder="Např. Grilování pro 6 lidí do 1200 Kč">${TEMPLATES.grill.defaultRequest}</textarea></label>
          <label class="sqSaveField">Počet lidí<input id="sqSavePeople" type="number" min="1" max="30" value="4"></label>
          <label class="sqSaveField">Rozpočet v Kč<input id="sqSaveBudget" type="number" min="0" step="50" placeholder="Např. 1200"></label>
        </div>
        <div class="sqSaveActions"><button class="sqSaveAction" type="button" data-sq-cancel>Zrušit</button><button id="sqSaveAction" class="sqSaveAction primary" type="button">Najít dnešní akce</button></div>
        <div id="sqSaveResult" class="sqSaveResult" hidden></div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-sq-scenario]').forEach((button) => button.addEventListener('click', () => selectScenario(modal, button.dataset.sqScenario)));
    modal.querySelector('.sqSaveClose').addEventListener('click', () => closeModal(modal));
    modal.querySelector('[data-sq-cancel]').addEventListener('click', () => closeModal(modal));
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeModal(modal); });
    modal.querySelector('#sqSaveAction').addEventListener('click', async () => {
      const brief = saveBrief(modal);
      const result = modal.querySelector('#sqSaveResult');
      result.hidden = false;
      if (selected === 'custom') {
        result.className = 'sqSaveResult good';
        result.innerHTML = '<strong>Zadání je uložené</strong>Vlastní požadavek zatím neposíláme do žádné falešné AI. Datová struktura je připravená pro budoucí planner; mezitím můžeš nákup sestavit v existujícím seznamu.<br><a href="seznam.html">Otevřít nákupní seznam →</a>';
        return;
      }
      await runTemplate(modal, brief);
    });
    return modal;
  }

  function init() {
    if (document.querySelector('.sqSaveTodayButton')) return;
    const stats = document.querySelector('.heroStats');
    if (!stats) return;
    const modal = createModal();
    const wrap = document.createElement('div');
    wrap.className = 'sqSaveTodayWrap';
    wrap.innerHTML = '<button class="sqSaveTodayButton" type="button"><span>✦</span>Ušetři mi dnes peníze</button><small class="sqSaveTodayHint">Reálné dnešní ceny · žádná falešná AI</small>';
    stats.after(wrap);
    wrap.querySelector('.sqSaveTodayButton').addEventListener('click', () => openModal(modal));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
