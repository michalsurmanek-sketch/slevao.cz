(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const ANON_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PRODUCT_UPLOAD_FUNCTION = `${SUPABASE_URL}/functions/v1/upload-product-image`;
  const LEGACY_FUNCTION = `${SUPABASE_URL}/functions/v1/homepage-leaflet-image`;
  const STORAGE_BUCKET = 'product-images';
  const LEGACY_BUCKET = 'homepage-leaflet-images';
  const COVER_META_KEY = 'slevao-cover';
  const EMPTY_META_BASE = 'https://slevao.cz/';
  const MAX_BYTES = 8 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
  const EXTENSIONS = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
  ]);

  const $ = (id) => document.getElementById(id);
  const db = window.supabase?.createClient(SUPABASE_URL, ANON_KEY);
  let stores = [];
  let selected = null;
  let chosenFile = null;
  let previewObjectUrl = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const fold = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function show(text, type = 'ok') {
    const box = $('message');
    if (!box) return;
    box.textContent = text;
    box.className = `msg ${type}`;
  }

  function clearMessage() {
    const box = $('message');
    if (!box) return;
    box.textContent = '';
    box.className = '';
  }

  function parseMeta(value) {
    const raw = String(value || '').trim();
    const index = raw.indexOf('#');
    if (index < 0) return { base: raw, params: new URLSearchParams() };
    return {
      base: raw.slice(0, index),
      params: new URLSearchParams(raw.slice(index + 1)),
    };
  }

  function markerIn(value) {
    return parseMeta(value).params.get(COVER_META_KEY) || '';
  }

  function coverMarker(store) {
    return markerIn(store?.website_url) || markerIn(store?.logo_url) || '';
  }

  function markerField(store) {
    if (markerIn(store?.website_url)) return 'website_url';
    if (markerIn(store?.logo_url)) return 'logo_url';
    if (String(store?.website_url || '').trim()) return 'website_url';
    if (String(store?.logo_url || '').trim()) return 'logo_url';
    return 'website_url';
  }

  function withMarker(value, marker) {
    const parsed = parseMeta(value);
    parsed.params.set(COVER_META_KEY, marker);
    return `${parsed.base || EMPTY_META_BASE}#${parsed.params.toString()}`;
  }

  async function persistMarker(store, marker) {
    const { data: fresh, error: readError } = await db.from('stores')
      .select('id,name,slug,logo_url,website_url,is_active')
      .eq('id', store.id)
      .single();
    if (readError || !fresh) {
      throw new Error(`Obrázek se nahrál, ale aktuální obchod se nepodařilo načíst: ${readError?.message || 'obchod nebyl nalezen'}`);
    }

    const field = markerField(fresh);
    const nextValue = withMarker(fresh[field], marker);
    const { data, error } = await db.from('stores')
      .update({ [field]: nextValue })
      .eq('id', store.id)
      .select('id,name,slug,logo_url,website_url,is_active')
      .single();
    if (error) throw new Error(`Obrázek se nahrál, ale nepodařilo se ho přiřadit k obchodu: ${error.message}`);
    Object.assign(store, data || fresh, { [field]: nextValue });
    selected = store;
    const index = stores.findIndex((item) => item.id === store.id);
    if (index >= 0) stores[index] = store;
  }

  async function currentSession() {
    if (!db) throw new Error('Supabase se nepodařilo načíst. Obnov stránku přes Ctrl+F5.');
    const { data, error } = await db.auth.getSession();
    const current = data?.session;
    if (error || !current) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
    if (!['admin', 'editor'].includes(current.user.app_metadata?.role)) {
      throw new Error('Účet nemá oprávnění upravovat obrázky.');
    }
    return current;
  }

  async function fetchWithTimeout(url, options, milliseconds = 30000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), milliseconds);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function responseJson(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text || `HTTP ${response.status}` };
    }
  }

  function validateFile(file) {
    if (!file) return 'Vyber fotografii.';
    if (!ALLOWED_TYPES.has(file.type)) return 'Vyber JPG, PNG, WEBP nebo AVIF.';
    if (!file.size) return 'Vybraný soubor je prázdný.';
    if (file.size > MAX_BYTES) return 'Fotografie je větší než 8 MB.';
    return '';
  }

  function resetFile() {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
    chosenFile = null;
    if ($('file')) $('file').value = '';
    $('localPreview')?.classList.add('hidden');
    if ($('upload')) $('upload').disabled = true;
  }

  function chooseFile(file) {
    resetFile();
    const error = validateFile(file);
    if (error) return show(error, 'err');
    chosenFile = file;
    clearMessage();
    previewObjectUrl = URL.createObjectURL(file);
    $('localPreviewImg').src = previewObjectUrl;
    $('fileName').textContent = file.name;
    $('fileMeta').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type.replace('image/', '').toUpperCase()}`;
    $('localPreview').classList.remove('hidden');
    $('upload').disabled = false;
  }

  function logo(store) {
    const logoUrl = parseMeta(store.logo_url).base;
    if (!logoUrl) return '%';
    return `<img src="${esc(logoUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('%'))">`;
  }

  function renderStores() {
    const term = fold($('storeSearch')?.value.trim());
    const rows = stores.filter((store) => !term || fold(`${store.name} ${store.slug}`).includes(term));
    $('storeList').innerHTML = rows.length ? rows.map((store) => `
      <button class="storeItem ${selected?.id === store.id ? 'active' : ''}" type="button" data-store="${esc(store.id)}">
        <span class="storeLogo">${logo(store)}</span>
        <span><strong>${esc(store.name)}</strong><small>${esc(store.slug)}${store.is_active ? '' : ' · skrytý'}</small></span>
        <span class="statusDot ${store.is_active ? 'visible' : ''}"></span>
      </button>
    `).join('') : '<div class="empty">Žádný obchod neodpovídá hledání.</div>';
    $('storeList').querySelectorAll('[data-store]').forEach((button) => {
      button.addEventListener('click', () => selectStore(stores.find((store) => store.id === button.dataset.store)));
    });
  }

  function legacyImageUrl(slug) {
    return `${SUPABASE_URL}/storage/v1/object/public/${LEGACY_BUCKET}/${encodeURIComponent(slug)}/cover?v=${Date.now()}`;
  }

  async function probeImage(url) {
    if (!url || url === 'none') return '';
    return new Promise((resolve) => {
      const image = new Image();
      const timer = window.setTimeout(() => resolve(''), 9000);
      image.onload = () => { window.clearTimeout(timer); resolve(url); };
      image.onerror = () => { window.clearTimeout(timer); resolve(''); };
      image.src = `${url}${url.includes('?') ? '&' : '?'}admin_probe=${Date.now()}`;
    });
  }

  async function currentImage(store) {
    const marker = coverMarker(store);
    if (marker === 'none') return '';
    if (marker) {
      const mapped = await probeImage(marker);
      if (mapped) return mapped;
    }
    return probeImage(legacyImageUrl(store.slug));
  }

  async function refreshCover() {
    if (!selected) return;
    $('coverBox').innerHTML = '<div class="coverPlaceholder"><span>▤</span><strong>Kontroluji vlastní obrázek…</strong></div>';
    $('remove').disabled = true;
    const url = await currentImage(selected);
    if (!url) {
      $('coverBox').classList.add('contain');
      $('coverBox').innerHTML = '<div class="coverPlaceholder"><span>⚙</span><strong>Používá se automatický náhled letáku</strong><p>Po nahrání fotografie bude nahrazen.</p></div>';
      return;
    }
    $('coverBox').classList.remove('contain');
    $('coverBox').innerHTML = `<img src="${esc(url)}" alt="Vlastní ukázková fotografie ${esc(selected.name)}"><span class="coverBadge">Vlastní obrázek</span>`;
    $('remove').disabled = false;
  }

  function selectStore(store) {
    if (!store) return;
    selected = store;
    resetFile();
    clearMessage();
    $('editorEmpty').classList.add('hidden');
    $('editor').classList.remove('hidden');
    $('selectedName').textContent = store.name;
    $('selectedSlug').textContent = store.slug;
    $('selectedPage').href = `${encodeURIComponent(store.slug)}.html`;
    renderStores();
    refreshCover();
  }

  function uniquePath(file, store) {
    const extension = EXTENSIONS.get(file.type) || 'jpg';
    const unique = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `homepage/${store.slug}/${Date.now()}-${unique}.${extension}`;
  }

  async function uploadDirect(file, store) {
    const path = uniquePath(file, store);
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: '31536000',
    });
    if (error) throw error;
    const publicUrl = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    return `${publicUrl}?v=${Date.now()}`;
  }

  async function uploadThroughExistingService(file, current) {
    const { data: products, error: productError } = await db.from('products').select('id').limit(1);
    if (productError || !products?.[0]?.id) {
      throw new Error(productError?.message || 'V databázi není pomocný produkt pro nahrání fotografie.');
    }
    const form = new FormData();
    form.append('product_id', products[0].id);
    form.append('file', file, file.name);
    const response = await fetchWithTimeout(PRODUCT_UPLOAD_FUNCTION, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.access_token}`, apikey: ANON_KEY },
      body: form,
    });
    const result = await responseJson(response);
    if (!response.ok || !result.ok || !result.candidate?.image_url) {
      throw new Error(result.error || `Záložní nahrávání vrátilo HTTP ${response.status}.`);
    }
    if (result.candidate.id) {
      db.from('product_image_candidates').delete().eq('id', result.candidate.id)
        .then(({ error }) => error && console.warn('Úklid pomocného kandidáta:', error.message));
    }
    return `${result.candidate.image_url}${result.candidate.image_url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  }

  async function uploadLegacy(file, store, current) {
    const form = new FormData();
    form.append('action', 'upload');
    form.append('store_slug', store.slug);
    form.append('file', file, file.name);
    const response = await fetchWithTimeout(LEGACY_FUNCTION, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.access_token}`, apikey: ANON_KEY },
      body: form,
    });
    const result = await responseJson(response);
    if (!response.ok || !result.ok || !result.image_url) {
      throw new Error(result.error || `Původní služba vrátila HTTP ${response.status}.`);
    }
    return `${result.image_url}${result.image_url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  }

  async function uploadImage(file, store, current) {
    const errors = [];
    try {
      show('Nahrávám fotografii na novou unikátní adresu…');
      return await uploadDirect(file, store);
    } catch (error) {
      errors.push(`úložiště: ${error?.message || error}`);
    }
    try {
      show('Přímé nahrání nebylo povoleno, používám záložní nahrávací službu…');
      return await uploadThroughExistingService(file, current);
    } catch (error) {
      errors.push(`záložní služba: ${error?.message || error}`);
    }
    try {
      show('Zkouším původní nahrávací službu…');
      return await uploadLegacy(file, store, current);
    } catch (error) {
      errors.push(`původní služba: ${error?.message || error}`);
    }
    throw new Error(`Fotografii se nepodařilo nahrát. ${errors.join(' | ')}`);
  }

  function storagePath(url, bucket) {
    const escapedBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(url || '').match(new RegExp(`/storage/v1/object/public/${escapedBucket}/(.+?)(?:[?#]|$)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function removePhysicalImage(url, store, current) {
    const path = storagePath(url, STORAGE_BUCKET);
    if (path) {
      await db.storage.from(STORAGE_BUCKET).remove([path]).catch(() => null);
      return;
    }
    if (String(url).includes(`/storage/v1/object/public/${LEGACY_BUCKET}/`)) {
      await fetchWithTimeout(LEGACY_FUNCTION, {
        method: 'POST',
        headers: { Authorization: `Bearer ${current.access_token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', store_slug: store.slug }),
      }, 9000).catch(() => null);
    }
  }

  async function loadStores() {
    const { data, error } = await db.from('stores')
      .select('id,name,slug,logo_url,website_url,is_active')
      .order('name');
    if (error) throw error;
    stores = (data || []).filter((store) => store.slug && store.name);
    renderStores();
  }

  async function authenticate() {
    const { data: { session: current } } = await db.auth.getSession();
    if (!current) {
      $('loginBox').classList.remove('hidden');
      $('app').classList.add('hidden');
      return;
    }
    if (!['admin', 'editor'].includes(current.user.app_metadata?.role)) {
      await db.auth.signOut();
      throw new Error('Účet nemá roli admin nebo editor.');
    }
    $('loginBox').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('who').textContent = `${current.user.email} · ${current.user.app_metadata.role}`;
    $('sideWho').textContent = `${current.user.email}\n${current.user.app_metadata.role}`;
    await loadStores();
  }

  function bind() {
    $('storeSearch').addEventListener('input', renderStores);
    $('file').addEventListener('change', () => chooseFile($('file').files?.[0]));
    ['dragenter', 'dragover'].forEach((type) => $('drop').addEventListener(type, (event) => {
      event.preventDefault();
      $('drop').classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach((type) => $('drop').addEventListener(type, (event) => {
      event.preventDefault();
      $('drop').classList.remove('drag');
    }));
    $('drop').addEventListener('drop', (event) => chooseFile(event.dataTransfer?.files?.[0]));

    $('upload').addEventListener('click', async () => {
      if (!selected) return show('Nejdřív vyber obchod.', 'err');
      const file = chosenFile || $('file').files?.[0];
      const validation = validateFile(file);
      if (validation) return show(validation, 'err');
      const previousUrl = coverMarker(selected);
      $('upload').disabled = true;
      try {
        const current = await currentSession();
        const imageUrl = await uploadImage(file, selected, current);
        show('Fotografie je nahraná. Přepínám kartu na nový obrázek…');
        await persistMarker(selected, imageUrl);
        if (previousUrl && previousUrl !== 'none' && previousUrl !== imageUrl) {
          removePhysicalImage(previousUrl, selected, current).catch(() => null);
        }
        show('Nová fotografie byla nahrána a starý obrázek byl nahrazen.');
        resetFile();
        await refreshCover();
        try {
          localStorage.setItem('slevao-homepage-image-changed', `${selected.slug}:${Date.now()}`);
        } catch { /* localStorage může být vypnuté */ }
        window.dispatchEvent(new CustomEvent('slevao:homepage-image-changed', { detail: { slug: selected.slug } }));
      } catch (error) {
        const message = error?.name === 'AbortError'
          ? 'Nahrávání překročilo časový limit. Zkus to znovu.'
          : error?.message || 'Fotografii se nepodařilo nahrát.';
        show(message, 'err');
        $('upload').disabled = !chosenFile;
      }
    });

    $('remove').addEventListener('click', async () => {
      if (!selected || !confirm(`Odstranit vlastní obrázek obchodu ${selected.name}? Automatický náhled letáku se znovu zapne.`)) return;
      const currentUrl = coverMarker(selected);
      $('remove').disabled = true;
      show('Vypínám vlastní obrázek na hlavní stránce…');
      try {
        const current = await currentSession();
        await persistMarker(selected, 'none');
        await removePhysicalImage(currentUrl, selected, current);
        show('Vlastní obrázek byl odstraněn. Karta znovu používá automatickou titulní stranu.');
        await refreshCover();
        try {
          localStorage.setItem('slevao-homepage-image-changed', `${selected.slug}:${Date.now()}`);
        } catch { /* localStorage může být vypnuté */ }
        window.dispatchEvent(new CustomEvent('slevao:homepage-image-changed', { detail: { slug: selected.slug } }));
      } catch (error) {
        show(error?.message || 'Obrázek se nepodařilo odstranit.', 'err');
        $('remove').disabled = false;
      }
    });

    $('loginBtn').addEventListener('click', async () => {
      const { error } = await db.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value,
      });
      if (error) {
        $('loginMsg').className = 'msg err';
        $('loginMsg').textContent = error.message;
        return;
      }
      authenticate().catch((authError) => {
        $('loginMsg').className = 'msg err';
        $('loginMsg').textContent = authError.message;
      });
    });

    $('logout').addEventListener('click', async () => {
      await db.auth.signOut();
      location.reload();
    });

    window.addEventListener('pagehide', () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    }, { once: true });
  }

  function init() {
    if (!db) {
      $('loginMsg').className = 'msg err';
      $('loginMsg').textContent = 'Supabase se nepodařilo načíst. Obnov stránku přes Ctrl+F5.';
      return;
    }
    bind();
    authenticate().catch((error) => {
      $('loginMsg').className = 'msg err';
      $('loginMsg').textContent = error.message;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
