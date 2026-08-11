(() => {
  'use strict';

  const productId = new URLSearchParams(location.search).get('id');
  const root = document.getElementById('productContent');
  if (!productId || !root) return;

  function exactIdentity(product) {
    const ean = String(product?.ean || '').trim();
    const brand = String(product?.brand || '').trim();
    const quantity = String(product?.quantity_text || '').trim();
    return Boolean(ean || (product?.is_verified === true && brand && quantity));
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

  function apply(mode) {
    const exact = mode === 'exact';
    root.dataset.identityMode = mode;
    root.dataset.identityReady = '1';
    document.body.dataset.productIdentity = mode;

    const eyebrow = root.querySelector('.sfHeroMain > .sfEyebrow');
    if (eyebrow) eyebrow.textContent = exact ? 'Porovnání stejného produktu' : 'Porovnání srovnatelných nabídek';

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
        note.innerHTML = '<strong>Srovnatelný produkt:</strong> chybí dostatečně silný identifikátor (např. EAN nebo ověřená značka + balení). Ceny proto ber jako porovnání obdobných nabídek, ne jako garantovaně stejné SKU.';
      } else if (note) {
        note.remove();
      }
    }

    const storeLabel = root.querySelector('.sfStats .sfStat:nth-child(4) small');
    if (storeLabel) storeLabel.textContent = exact ? 'Obchody s nabídkou' : 'Srovnávané obchody';

    const offerSection = document.getElementById('offers')?.closest('.sfSection');
    const offerEyebrow = offerSection?.querySelector('.sfSectionHead .sfEyebrow');
    if (offerEyebrow) {
      offerEyebrow.textContent = exact
        ? 'Platí nyní nebo začne do 7 dnů'
        : 'Srovnatelné nabídky · platí nyní nebo začnou do 7 dnů';
    }

    window.dispatchEvent(new CustomEvent('slevao:product-identity-ready', {
      detail:{ productId, mode, exact },
    }));
  }

  async function init() {
    try {
      const db = await getDb();
      const { data, error } = await db.from('products')
        .select('id,brand,ean,quantity_text,is_verified')
        .eq('id', productId)
        .maybeSingle();
      if (error) throw error;
      apply(exactIdentity(data) ? 'exact' : 'comparable');
    } catch {
      // Při nejistotě se nikdy netvrdí, že jde o přesně stejné SKU.
      apply('comparable');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
