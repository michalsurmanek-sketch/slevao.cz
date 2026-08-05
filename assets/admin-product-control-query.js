(() => {
  'use strict';
  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const issue = params.get('issue');
    const status = params.get('status');
    if (!issue && !status) return;

    const apply = () => {
      const issueFilter = document.getElementById('issueFilter');
      const statusFilter = document.getElementById('statusFilter');
      if (!issueFilter || !statusFilter) return false;
      if (issue && [...issueFilter.options].some((option) => option.value === issue)) issueFilter.value = issue;
      if (status && [...statusFilter.options].some((option) => option.value === status)) statusFilter.value = status;
      issueFilter.dispatchEvent(new Event('change', { bubbles:true }));
      statusFilter.dispatchEvent(new Event('change', { bubbles:true }));
      setTimeout(() => document.getElementById('table')?.scrollIntoView({ behavior:'smooth', block:'start' }), 180);
      return true;
    };

    if (apply()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (apply() || attempts > 20) clearInterval(timer);
    }, 150);
  });
})();

(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
  const MAX_FILE_SIZE = 8 * 1024 * 1024;

  window.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('editSave');
    const uploadInput = document.getElementById('editUpload');
    if (!saveButton || !uploadInput || !window.supabase) return;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const field = (id) => document.getElementById(id);
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    function setMessage(text, type = '') {
      const box = field('editMessage');
      if (!box) return;
      box.textContent = text;
      box.className = `formMessage${type ? ` ${type}` : ''}`;
    }

    function clearPublicCache() {
      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('slevao-public-data-'))
          .forEach((key) => localStorage.removeItem(key));
      } catch (error) {
        console.warn('Veřejnou cache se nepodařilo vymazat:', error);
      }
    }

    async function parseResponse(response) {
      const text = await response.text();
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Nahrávací služba vrátila neplatnou odpověď (${response.status}).`);
      }
    }

    async function uploadCandidate(productId, file, session) {
      if (!ALLOWED_TYPES.has(file.type)) throw new Error('Vyber fotografii JPG, PNG, WEBP nebo AVIF.');
      if (file.size > MAX_FILE_SIZE) throw new Error('Fotografie je větší než povolených 8 MB.');

      const form = new FormData();
      form.append('product_id', productId);
      form.append('file', file, file.name);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/upload-product-image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: form,
      });
      const output = await parseResponse(response);
      if (!response.ok || !output.ok || !output.candidate?.image_url) {
        throw new Error(output.error || 'Fotografii se nepodařilo nahrát.');
      }
      return output.candidate;
    }

    async function resolveCandidate(candidate, productId) {
      if (candidate.id) return candidate;
      const { data, error } = await db
        .from('product_image_candidates')
        .select('id,product_id,image_url,status')
        .eq('product_id', productId)
        .eq('image_url', candidate.image_url)
        .order('created_at', { ascending:false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error('Nahraná fotografie nemá identifikátor kandidáta a nelze ji schválit.');
      return data;
    }

    async function approveCandidate(candidate, productId, session) {
      const resolved = await resolveCandidate(candidate, productId);
      if (resolved.status !== 'approved') {
        const { data, error } = await db
          .from('product_image_candidates')
          .update({
            status: 'approved',
            reviewed_by: session.user.id,
            reviewed_at: new Date().toISOString(),
            rejection_reason: null,
          })
          .eq('id', resolved.id)
          .eq('product_id', productId)
          .select('id,product_id,image_url,status')
          .single();
        if (error) throw new Error(`Fotografie se nahrála, ale nešlo ji schválit: ${error.message}`);
        if (data?.status !== 'approved') throw new Error('Fotografie se nahrála, ale schválení nebylo potvrzeno.');
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { data: product, error } = await db
          .from('products')
          .select('id,image_url,image_verified,image_quality')
          .eq('id', productId)
          .single();
        if (error) throw error;
        if (product?.image_url === resolved.image_url && product.image_verified === true) return resolved.image_url;
        await wait(150 * (attempt + 1));
      }
      throw new Error('Fotografie byla schválena, ale databáze ji nenastavila jako hlavní obrázek produktu.');
    }

    async function saveWithUploadedPhoto(file) {
      const id = field('editId')?.value;
      const productId = field('editProductId')?.value;
      const title = field('editTitle')?.value.trim();
      const storeId = field('editStore')?.value;
      const status = field('editStatus')?.value;
      const price = Number(field('editPrice')?.value);
      const oldPrice = field('editOldPrice')?.value ? Number(field('editOldPrice').value) : null;
      const validFrom = field('editFrom')?.value;
      const validTo = field('editTo')?.value;

      if (!id || !productId) throw new Error('Nabídka nemá navázaný produkt, proto k ní nelze fotografii uložit.');
      if (!title || !storeId || !Number.isFinite(price) || price <= 0 || !validFrom || !validTo) {
        throw new Error('Vyplň název, obchod, cenu a platnost.');
      }
      if (oldPrice !== null && oldPrice < price) throw new Error('Původní cena nesmí být nižší než akční cena.');
      if (validFrom > validTo) throw new Error('Datum začátku nesmí být po datu konce.');

      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      const session = sessionData.session;
      const role = session?.user?.app_metadata?.role || '';
      if (!session || !['admin', 'editor'].includes(role)) throw new Error('Pro uložení fotografie se znovu přihlas jako admin nebo editor.');

      const { data: currentOffer, error: currentOfferError } = await db
        .from('offers')
        .select('id,published_at')
        .eq('id', id)
        .single();
      if (currentOfferError) throw currentOfferError;

      setMessage('Nahrávám novou fotografii…');
      const candidate = await uploadCandidate(productId, file, session);
      setMessage('Schvaluji fotografii a nastavuji ji jako hlavní…');
      const imageUrl = await approveCandidate(candidate, productId, session);

      const payload = {
        title,
        store_id: storeId,
        status,
        price,
        old_price: oldPrice,
        valid_from: validFrom,
        valid_to: validTo,
        image_url: imageUrl,
        published_at: status === 'published' ? (currentOffer.published_at || new Date().toISOString()) : null,
      };

      setMessage('Ukládám nabídku s novou fotografií…');
      const { data: savedOffer, error: offerError } = await db
        .from('offers')
        .update(payload)
        .eq('id', id)
        .select('id,image_url,product_id')
        .single();
      if (offerError) throw offerError;
      if (savedOffer?.image_url !== imageUrl) throw new Error('Nabídka byla uložena, ale nová fotografie se do ní nepropsala.');

      const { error: productError } = await db.from('products').update({ name:title }).eq('id', productId);
      if (productError) throw new Error(`Fotografie se uložila, ale název produktu ne: ${productError.message}`);

      clearPublicCache();
      field('editImage').value = imageUrl;
      uploadInput.value = '';
      setMessage('Fotografie byla nahrána, schválena a uložena jako hlavní.', 'ok');

      setTimeout(() => {
        field('editClose')?.click();
        field('reload')?.click();
      }, 650);
    }

    saveButton.addEventListener('click', async (event) => {
      const file = uploadInput.files?.[0];
      if (!file) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      saveButton.disabled = true;
      try {
        await saveWithUploadedPhoto(file);
      } catch (error) {
        console.error('Uložení nové produktové fotografie selhalo:', error);
        setMessage(error?.message || 'Fotografii se nepodařilo uložit.', 'error');
      } finally {
        saveButton.disabled = false;
      }
    }, true);
  });
})();

(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';

  window.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabase) return;
    const actions = document.querySelector('.headerActions');
    if (!actions || document.getElementById('trashAllOffers')) return;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: sessionData } = await db.auth.getSession();
    const session = sessionData.session;
    const role = String(session?.user?.app_metadata?.role || '').toLowerCase();
    if (!session || role !== 'admin') return;

    const button = document.createElement('button');
    button.id = 'trashAllOffers';
    button.type = 'button';
    button.className = 'btn danger';
    button.textContent = 'Smazat všechny nabídky';
    button.title = 'Přesune všechny nabídky do koše. Produkty, fotografie a knihovna zůstanou zachované.';
    actions.insertBefore(button, actions.firstChild);

    const showMessage = (text, type = 'ok') => {
      const box = document.getElementById('pageMessage');
      if (!box) return;
      box.textContent = text;
      box.className = `notice ${type}`;
      box.classList.remove('hidden');
    };

    button.addEventListener('click', async () => {
      const first = confirm('Opravdu chceš přesunout VŠECHNY nabídky všech obchodů do koše? Produkty, fotografie a knihovna zůstanou zachované.');
      if (!first) return;
      const phrase = prompt('Pro potvrzení napiš přesně: SMAZAT VŠECHNY NABÍDKY');
      if (phrase !== 'SMAZAT VŠECHNY NABÍDKY') {
        showMessage('Akce byla zrušena.', 'warning');
        return;
      }

      button.disabled = true;
      showMessage('Přesouvám všechny nabídky do koše…', 'warning');
      try {
        const { data, error } = await db.functions.invoke('trash-all-offers', {
          body: { confirmation: 'SMAZAT VŠECHNY NABÍDKY' },
        });
        if (error || !data?.ok) throw new Error(error?.message || data?.error || 'Hromadné mazání selhalo.');

        try {
          Object.keys(localStorage)
            .filter((key) => key.startsWith('slevao-public-data-'))
            .forEach((key) => localStorage.removeItem(key));
        } catch {}

        showMessage(`Hotovo. Do koše bylo přesunuto ${Number(data.moved_to_trash || 0).toLocaleString('cs-CZ')} nabídek.`, 'ok');
        setTimeout(() => document.getElementById('reload')?.click(), 400);
      } catch (error) {
        console.error('Hromadné smazání nabídek selhalo:', error);
        showMessage(error?.message || 'Hromadné mazání selhalo.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
})();