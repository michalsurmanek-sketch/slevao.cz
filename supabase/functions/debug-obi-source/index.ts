const SOURCE_URL = 'https://www.obi.cz/nabidky/aktualni-letak';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

async function fetchResponse(url: string, headers: Record<string, string> = HEADERS, timeout = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    return { status: response.status, url: response.url, text };
  } finally {
    clearTimeout(timer);
  }
}

function decodeBase64Json(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return JSON.parse(atob(normalized));
}

Deno.serve(async () => {
  const page = await fetchResponse(SOURCE_URL);
  const authKey = page.text.match(/discBonialWidgetId([a-f0-9]{16,64})/i)?.[1]
    || page.text.match(/"authKey"\s*:\s*"([a-f0-9]{16,64})"/i)?.[1]
    || '';
  if (!authKey) return Response.json({ error: 'OBI Bonial auth key not found', page_status: page.status }, { status: 502 });

  const paramsResponse = await fetchResponse(
    `https://bonialconnect.com/params/connect/v1/keys/${authKey}/encoded.json?_=${Date.now()}`,
    { ...HEADERS, accept: 'application/json', referer: SOURCE_URL },
  );
  const paramsEnvelope = JSON.parse(paramsResponse.text);
  const params = typeof paramsEnvelope.data === 'string' ? decodeBase64Json(paramsEnvelope.data) : paramsEnvelope.data;
  const publisherId = /^[A-Z]{2}-/i.test(String(params.publisherId || ''))
    ? String(params.publisherId)
    : `${String(params.market || 'de').toUpperCase()}-${String(params.publisherId || '')}`;
  const apiBase = `${String(params.apiHost || '').replace(/\/$/, '')}/${String(params.market || 'de')}`;
  const apiHeaders = {
    ...HEADERS,
    accept: 'application/json',
    referer: SOURCE_URL,
    'Bonial-Api-Consumer': 'Bonial-Connect-Widget',
    'X-Auth-Key': authKey,
  };

  const storesResponse = await fetchResponse(
    `${apiBase}/stores/default/byPublisher?publisherId=${encodeURIComponent(publisherId)}`,
    apiHeaders,
  );
  const stores = JSON.parse(storesResponse.text);
  const store = Array.isArray(stores) ? stores[0] : stores;
  if (!store?.id) {
    return Response.json({ error: 'OBI default store not found', stores_status: storesResponse.status, stores }, { status: 502 });
  }

  const brochuresResponse = await fetchResponse(
    `${apiBase}/stores/${encodeURIComponent(store.id)}/brochures?publisherId=${encodeURIComponent(publisherId)}&limit=100`,
    apiHeaders,
  );
  let brochures: unknown = null;
  try { brochures = JSON.parse(brochuresResponse.text); } catch { brochures = brochuresResponse.text.slice(0, 4000); }

  return Response.json({
    ok: brochuresResponse.status >= 200 && brochuresResponse.status < 300,
    auth_key: authKey,
    publisher_id: publisherId,
    api_base: apiBase,
    store: { id: store.id, name: store.name, city: store.city, zip: store.zip },
    params: {
      language: params.language,
      location_api_country: params.locationApiCountry,
      key_active: params.keyActive,
      brochure_validity_date_enabled: params.brochureValidityDateEnabled,
      skip_shelf_for_one_brochure: params.skipShelfForOneBrochure,
    },
    brochures_status: brochuresResponse.status,
    brochures,
  });
});
