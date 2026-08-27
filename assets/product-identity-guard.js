(() => {
  'use strict';

  const productId = new URLSearchParams(location.search).get('id');
  const root = document.getElementById('productContent');
  if (!productId || !root) return;

  function identityMode(product) {
    const ean = String(product?.ean || '').trim();
    const brand = String(product?.brand || '').trim();
    const quantity = String(product?.quantity_text || '').trim();
    const verifiedCommodity = product?.is_verified === true
      && product?.metadata?.identity_type === 'verified_commodity'
      && quantity;
    if (ean || verifiedCommodity) return 'exact';
    if (product?.is_verified === true && brand && quantity) return 'verified_group';
    return 'comparable';
  }

  async function getDb(timeout = 5000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
      if (window.supabase?.createClient) {
        return window.supabase.createClient(
          'https://uhampjdqjxmbhaptgitn.supabase.co',
          'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU',
          { auth:{ persistSession:false, autoRefreshToken:false } },
        );
      }
    }
    throw new Error('Datová služba identity není dostupná.');
  }

  async function loadProduct() {
    const shared = window.__slevaoProductPromise;
    if (shared && typeof shared.then === 'function') {
      try {
        const result = await shared;
        if (!result?.error && result?.data) return result.data;
      } catch {}
    }

    const db = await getDb();
    const { data, error } = await db.from('products')
      .select('id,brand,ean,quantity_text,is_verified,metadata')
      .eq('id', productId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  function updateDynamicCopy(mode) {
    const exact = mode === 'exact';
    const grouped = mode === 'verified_group';
    const statLabels = root.querySelectorAll('.sfStats .sfStat small');
    if (statLabels[0]) statLabels[0].textContent = exact ? 'Nejnižší za 30 dní' : grouped ? 'Nejnižší cena skupiny za 30 dní' : 'Minimum srovnatelných cen za 30 dní';
    if (statLabels[1]) statLabels[1].textContent = exact ? 'Nejnižší za 90 dní' : grouped ? 'Nejnižší cena skupiny za 90 dní' : 'Minimum srovnatelných cen za 90 dní';
    if (statLabels[2]) statLabels[2].textContent = exact ? 'Obvyklá akční cena' : grouped ? 'Typická cena ověřené skupiny' : 'Typická srovnatelná cena';
    if (statLabels[3]) statLabels[3].textContent = exact ? 'Obchody s nabídkou' : grouped ? 'Obchody v ověřené skupině' : 'Srovnávané obchody';

    const historySection = document.getElementById('priceChart')?.closest('.sfSection');
    const historyEyebrow = historySection?.querySelector('.sfSectionHead .sfEyebrow');
    const historyTitle = historySection?.querySelector('.sfSectionHead h2');
    if (historyEyebrow) historyEyebrow.textContent = exact ? 'Historie cen' : grouped ? 'Historie ověřené skupiny' : 'Historie srovnatelných cen';
    if (historyTitle) historyTitle.textContent = exact ? 'Jak se cena měnila' : grouped ? 'Jak se měnila cena této skupiny' : 'Jak se měnily srovnatelné ceny';

    if (!exact) {
      const currentCopy = document.querySelector('#currentStore .sfCurrentStore > span:last-child');
      if (currentCopy) {
        currentCopy.textContent = grouped
          ? currentCopy.textContent
              .replace(/^Právě teď nejlevněji v /, 'Nejnižší cena ověřené skupiny nyní v ')
              .replace(/^(Od .+?) nejlevněji v /, '$1 nejnižší cena ověřené skupiny v ')
          : currentCopy.textContent
              .replace(/^Právě teď nejlevněji v /, 'Nejnižší srovnatelná nabídka nyní v ')
              .replace(/^(Od .+?) nejlevněji v /, '$1 nejnižší srovnatelná nabídka v ');
      }

      document.querySelectorAll('#offers .sfOfferStore').forEach((node) => {
        node.textContent = grouped
          ? node.textContent
              .replace(' · nejnižší cena dnes', ' · nejnižší cena skupiny dnes')
              .replace(' · nejnižší nadcházející cena', ' · nejnižší nadcházející cena skupiny')
          : node.textContent
              .replace(' · nejnižší cena dnes', ' · nejnižší srovnatelná cena dnes')
              .replace(' · nejnižší nadcházející cena', ' · nejnižší srovnatelná nadcházející cena');
      });
      document.querySelectorAll('#offers [data-alert-offer]').forEach((button) => {
        button.textContent = grouped ? 'Hlídat cenu skupiny' : 'Hlídat srovnatelné ceny';
        button.setAttribute('aria-label', grouped
          ? 'Hlídat cenu v této ověřené skupině bez EAN garance'
          : 'Hlídat cenu v této skupině srovnatelných nabídek');
      });
    }
  }

  function apply(mode) {
    const exact = mode === 'exact';
    const grouped = mode === 'verified_group';
    root.dataset.identityMode = mode;
    root.dataset.identityReady = '1';
    document.body.dataset.productIdentity = mode;

    const eyebrow = root.querySelector('.sfHeroMain > .sfEyebrow');
    if (eyebrow) eyebrow.textContent = exact
      ? 'Porovnání stejného produktu'
      : grouped
        ? 'Ověřené seskupení produktu'
        : 'Porovnání srovnatelných nabídek';

    const meta = document.getElementById('productMeta');
    if (meta) {
      let note = document.getElementById('productIdentityNote');
      if (!exact) {
        if (!note) {
          note = document.createElement('p');
          note.id = 'productIdentityNote';
          note.className = 'sfIdentityNotice';
          meta.after(note);
        }
        note.innerHTML = grouped
          ? '<strong>Ověřené seskupení bez EAN:</strong> nabídky jsou spojeny podle ověřeného názvu, značky a balení. To je silná shoda, ale ne EAN-garantovaná identita jednoho SKU.'
          : '<strong>Srovnatelný produkt:</strong> chybí dostatečně silný identifikátor. Ceny proto ber jako porovnání obdobných nabídek, ne jako garantovaně stejné SKU.';
      } else if (note) {
        note.remove();
      }
    }

    const offerSection = document.getElementById('offers')?.closest('.sfSection');
    const offerEyebrow = offerSection?.querySelector('.sfSectionHead .sfEyebrow');
    if (offerEyebrow) {
      offerEyebrow.textContent = exact
        ? 'Platí nyní nebo začne do 7 dnů'
        : grouped
          ? 'Ověřená skupina · platí nyní nebo začne do 7 dnů'
          : 'Srovnatelné nabídky · platí nyní nebo začnou do 7 dnů';
    }

    updateDynamicCopy(mode);
    window.addEventListener('slevao:product-offers-rendered', () => updateDynamicCopy(mode));

    window.dispatchEvent(new CustomEvent('slevao:product-identity-ready', {
      detail:{ productId, mode, exact, grouped },
    }));
  }

  async function init() {
    try {
      const data = await loadProduct();
      apply(identityMode(data));
    } catch {
      // Při nejistotě se nikdy netvrdí, že jde o přesně stejné SKU.
      apply('comparable');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();