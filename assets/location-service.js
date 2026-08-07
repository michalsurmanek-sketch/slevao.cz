(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const TODAY = new Date().toISOString().slice(0, 10);

  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const readList = () => {
    try {
      const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (value) => Number(value) * Math.PI / 180;
    const aLat = Number(lat1), aLon = Number(lon1), bLat = Number(lat2), bLon = Number(lon2);
    if (![aLat, aLon, bLat, bLon].every(Number.isFinite)) return Infinity;
    const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function rest(table, params = {}) {
    const query = new URLSearchParams(params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Databáze vrátila chybu ${response.status}.`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Tento prohlížeč nepodporuje polohu.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number(position.coords.accuracy || 0),
          capturedAt: Date.now(),
        }),
        (error) => reject(new Error(error.code === 1 ? 'Poloha nebyla povolena.' : 'Polohu se nepodařilo určit.')),
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 },
      );
    });
  }

  async function fetchNearbyBranches(latitude, longitude, radiusKm = 15) {
    const lat = Number(latitude), lon = Number(longitude), radius = Math.max(1, Math.min(50, Number(radiusKm) || 15));
    const latDelta = radius / 111;
    const lonDelta = radius / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
    const rows = await rest('branches', {
      select: 'id,store_id,name,street,city,postal_code,latitude,longitude,opening_hours,stores(id,name,slug,logo_url,primary_color)',
      is_active: 'eq.true',
      latitude: `gte.${lat - latDelta}`,
      longitude: `gte.${lon - lonDelta}`,
      and: `(latitude.lte.${lat + latDelta},longitude.lte.${lon + lonDelta})`,
      limit: '1000',
    });
    return rows
      .map((row) => ({ ...row, distance_km: distanceKm(lat, lon, row.latitude, row.longitude) }))
      .filter((row) => row.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);
  }

  async function searchBranchesByPlace(value) {
    const term = String(value || '').trim();
    if (!term) return [];
    const digits = term.replace(/\D/g, '');
    const params = {
      select: 'id,store_id,name,street,city,postal_code,latitude,longitude,opening_hours,stores(id,name,slug,logo_url,primary_color)',
      is_active: 'eq.true',
      limit: '800',
    };
    if (digits.length === 5) {
      params.or = `(postal_code.ilike.*${digits}*,postal_code.ilike.*${digits.slice(0, 3)} ${digits.slice(3)}*)`;
    } else {
      params.city = `ilike.*${term.replace(/[,*()]/g, ' ')}*`;
    }
    return await rest('branches', params);
  }

  function uniqueStores(branches) {
    const map = new Map();
    for (const branch of branches || []) {
      if (!branch.store_id) continue;
      const current = map.get(branch.store_id);
      if (!current || Number(branch.distance_km ?? Infinity) < Number(current.distance_km ?? Infinity)) map.set(branch.store_id, branch);
    }
    return [...map.values()].sort((a, b) => Number(a.distance_km ?? Infinity) - Number(b.distance_km ?? Infinity));
  }

  function coverageMatches(offer, branches) {
    const scope = String(offer?.coverage_scope || 'national');
    if (!scope || scope === 'national') return true;
    const storeBranches = (branches || []).filter((branch) => String(branch.store_id) === String(offer.store_id));
    if (!storeBranches.length) return false;
    if (scope === 'city') {
      const city = fold(offer.city_name);
      return Boolean(city) && storeBranches.some((branch) => fold(branch.city) === city);
    }
    if (scope === 'store') return false;
    if (scope === 'region') return false;
    return false;
  }

  async function fetchOffersForList(rows, storeIds, branches = []) {
    const productIds = [...new Set((rows || []).filter((row) => !row.completed && row.product_id).map((row) => String(row.product_id)))];
    const stores = [...new Set((storeIds || []).filter(Boolean).map(String))];
    if (!productIds.length || !stores.length) return [];
    const output = [];
    for (let from = 0; from < productIds.length; from += 35) {
      const ids = productIds.slice(from, from + 35);
      const batch = await rest('offers', {
        select: 'id,product_id,store_id,title,price,old_price,valid_from,valid_to,coverage_scope,region_code,city_name,stores(id,name,slug)',
        product_id: `in.(${ids.join(',')})`,
        store_id: `in.(${stores.join(',')})`,
        status: 'eq.published',
        valid_from: `lte.${TODAY}`,
        valid_to: `gte.${TODAY}`,
        limit: '5000',
      });
      output.push(...batch);
    }
    return output.filter((offer) => coverageMatches(offer, branches));
  }

  function basketMetrics(rows, offers) {
    const active = (rows || []).filter((row) => !row.completed && row.product_id);
    const chosen = [];
    let total = 0, referenceTotal = 0;
    for (const row of active) {
      const candidates = (offers || []).filter((offer) => String(offer.product_id) === String(row.product_id));
      if (!candidates.length) continue;
      const offer = candidates.slice().sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
      const quantity = Math.max(0.01, Number(row.quantity || 1));
      const price = Math.max(0, Number(offer.price || 0));
      const oldPrice = Number(offer.old_price || 0) > price ? Number(offer.old_price) : price;
      const subtotal = price * quantity;
      total += subtotal;
      referenceTotal += oldPrice * quantity;
      chosen.push({ row, offer, subtotal });
    }

    const stores = [...new Set((offers || []).map((offer) => offer.store_id).filter(Boolean))];
    const oneStorePlans = [];
    for (const storeId of stores) {
      let storeTotal = 0;
      let matched = 0;
      for (const row of active) {
        const candidate = (offers || [])
          .filter((offer) => String(offer.product_id) === String(row.product_id) && String(offer.store_id) === String(storeId))
          .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
        if (!candidate) continue;
        matched++;
        storeTotal += Number(candidate.price || 0) * Math.max(0.01, Number(row.quantity || 1));
      }
      if (matched === active.length && active.length) {
        const sample = offers.find((offer) => String(offer.store_id) === String(storeId));
        oneStorePlans.push({ store_id: storeId, store_name: sample?.stores?.name || 'Obchod', total: storeTotal });
      }
    }
    oneStorePlans.sort((a, b) => a.total - b.total);

    return {
      itemCount: active.length,
      matchedCount: chosen.length,
      total: Number(total.toFixed(2)),
      referenceTotal: Number(referenceTotal.toFixed(2)),
      savings: Number(Math.max(0, referenceTotal - total).toFixed(2)),
      chosen,
      bestSingleStore: oneStorePlans[0] || null,
    };
  }

  function branchLabel(branch) {
    return [branch?.stores?.name || branch?.name, branch?.city].filter(Boolean).join(' · ');
  }

  window.SlevaoLocation = {
    TODAY,
    money,
    fold,
    readList,
    rest,
    getPosition,
    distanceKm,
    fetchNearbyBranches,
    searchBranchesByPlace,
    uniqueStores,
    coverageMatches,
    fetchOffersForList,
    basketMetrics,
    branchLabel,
  };
})();
