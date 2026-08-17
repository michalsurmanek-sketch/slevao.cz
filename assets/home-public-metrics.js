(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  let authoritative = null;

  async function rpc(name, body, signal) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type':'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
      signal
    });
    if (!response.ok) throw new Error(`${name} ${response.status}`);
    return response.json();
  }

  function applyMetrics() {
    if (!authoritative) return;
    const offerCount = document.getElementById('offerCount');
    const storeCount = document.getElementById('storeCount');
    if (!offerCount || !storeCount) return;

    if (authoritative.current > 0) {
      const value = authoritative.current.toLocaleString('cs-CZ');
      if (offerCount.textContent !== value) offerCount.textContent = value;
      offerCount.dataset.authoritative = '1';
      offerCount.title = authoritative.upcoming > 0
        ? `${value} nabídek platí dnes, dalších ${authoritative.upcoming.toLocaleString('cs-CZ')} začne během 7 dnů.`
        : `${value} nabídek platí dnes.`;
    }
    if (authoritative.stores > 0) {
      const value = authoritative.stores.toLocaleString('cs-CZ');
      if (storeCount.textContent !== value) storeCount.textContent = value;
      storeCount.dataset.authoritative = '1';
      storeCount.title = `${value} obchodů má zobrazitelné nabídky.`;
    }
  }

  async function loadMetrics() {
    const offerCount = document.getElementById('offerCount');
    const storeCount = document.getElementById('storeCount');
    if (!offerCount || !storeCount) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const [metricRows, storeRows] = await Promise.all([
        rpc('get_public_offer_metrics', {}, controller.signal),
        rpc('get_public_store_facets', { p_include_upcoming:true }, controller.signal)
      ]);
      const metrics = Array.isArray(metricRows) ? metricRows[0] : null;
      authoritative = {
        current: Number(metrics?.current_displayable || 0),
        upcoming: Number(metrics?.upcoming_displayable || 0),
        stores: Array.isArray(storeRows) ? storeRows.length : 0
      };
      applyMetrics();

      const resultText = document.getElementById('resultText');
      if (resultText) {
        new MutationObserver(() => queueMicrotask(applyMetrics)).observe(resultText, {
          childList:true,
          subtree:true,
          characterData:true
        });
      }
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('Autoritativní metriky nejsou dostupné:', error);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadMetrics, { once:true });
  else loadMetrics();
})();
