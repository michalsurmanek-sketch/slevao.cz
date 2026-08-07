(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const db = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  if (!db) return;

  let timer = 0;
  let running = false;
  let rerun = false;
  let equivalenceCache = null;

  async function links() {
    if (equivalenceCache) return equivalenceCache;
    equivalenceCache = db.from('product_equivalences')
      .select('product_id_a,product_id_b')
      .eq('is_active', true)
      .gte('confidence', .99)
      .limit(1000)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      });
    return equivalenceCache;
  }

  function priceInfo(card) {
    const text = card.querySelector('.sfResultPrice')?.textContent || '';
    const numeric = Number(text.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    const upcoming = Boolean(card.querySelector('.sfUpcomingText'));
    const noPrice = !Number.isFinite(numeric) || !/[0-9]/.test(text);
    return { state: noPrice ? 2 : upcoming ? 1 : 0, price: noPrice ? Infinity : numeric };
  }

  function components(ids, allLinks) {
    const visible = new Set(ids);
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (id) => {
      let root = parent.get(id);
      while (root !== parent.get(root)) root = parent.get(root);
      let node = id;
      while (parent.get(node) !== root) {
        const next = parent.get(node);
        parent.set(node, root);
        node = next;
      }
      return root;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };
    for (const link of allLinks) {
      const a = String(link.product_id_a || '');
      const b = String(link.product_id_b || '');
      if (visible.has(a) && visible.has(b)) union(a, b);
    }
    const grouped = new Map();
    for (const id of ids) {
      const root = find(id);
      const rows = grouped.get(root) || [];
      rows.push(id);
      grouped.set(root, rows);
    }
    return [...grouped.values()].filter((group) => group.length > 1);
  }

  function primaryCard(group, cardMap) {
    return group
      .map((id) => cardMap.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const pa = priceInfo(a), pb = priceInfo(b);
        return pa.state - pb.state || pa.price - pb.price || String(a.dataset.productId).localeCompare(String(b.dataset.productId));
      })[0] || null;
  }

  function badge(card, count) {
    card.dataset.eqPrimary = '1';
    if (card.querySelector('.sfEqSearchBadge')) return;
    const meta = card.querySelector('.sfResultMeta');
    if (!meta) return;
    const node = document.createElement('span');
    node.className = 'sfEqSearchBadge';
    node.textContent = `${count} potvrzené záznamy spojeny`;
    meta.after(node);
  }

  async function apply() {
    if (running) { rerun = true; return; }
    running = true;
    try {
      const root = document.getElementById('results');
      if (!root) return;
      const cards = [...root.querySelectorAll('.sfProductResult[data-product-id]')];
      if (cards.length < 2) return;

      const cardMap = new Map(cards.map((card) => [String(card.dataset.productId), card]));
      cards.forEach((card) => {
        card.hidden = false;
        delete card.dataset.eqPrimary;
        card.querySelector('.sfEqSearchBadge')?.remove();
      });

      const groups = components([...cardMap.keys()], await links());
      let hidden = 0;
      for (const group of groups) {
        const primary = primaryCard(group, cardMap);
        if (!primary) continue;
        badge(primary, group.length);
        for (const id of group) {
          const card = cardMap.get(id);
          if (!card || card === primary) continue;
          card.hidden = true;
          hidden++;
        }
      }

      if (hidden) {
        const visible = cards.length - hidden;
        const message = document.getElementById('searchMessage');
        if (message) message.textContent = `${visible} produktů · ${hidden} potvrzených duplicitních záznamů sloučeno.`;
      }
    } catch (error) {
      console.warn('SLEVAO search equivalence:', error?.message || error);
    } finally {
      running = false;
      if (rerun) { rerun = false; schedule(); }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(apply, 120);
  }

  function init() {
    const root = document.getElementById('results');
    if (!root) return;
    new MutationObserver(schedule).observe(root, { childList: true });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
