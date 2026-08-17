(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';

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
      const current = Number(metrics?.current_displayable || 0);
      const upcoming = Number(metrics?.upcoming_displayable || 0);
      const stores = Array.isArray(storeRows) ? storeRows.length : 0;
      if (current > 0) {
        offerCount.textContent = current.toLocaleString('cs-CZ');
        offerCount.dataset.authoritative = '1';
        offerCount.title = upcoming > 0
          ? `${current.toLocaleString('cs-CZ')} nabídek platí dnes, dalších ${upcoming.toLocaleString('cs-CZ')} začne během 7 dnů.`
          : `${current.toLocaleString('cs-CZ')} nabídek platí dnes.`;
      }
      if (stores > 0) {
        storeCount.textContent = stores.toLocaleString('cs-CZ');
        storeCount.dataset.authoritative = '1';
        storeCount.title = `${stores.toLocaleString('cs-CZ')} obchodů má zobrazitelné nabídky.`;
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
