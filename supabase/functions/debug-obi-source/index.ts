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
    return { status: response.status, url: response.url, text: await response.text() };
  } finally { clearTimeout(timer); }
}
function decodeBase64Json(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return JSON.parse(atob(normalized));
}
function summarizeDetail(detail: any) {
  const pages = Array.isArray(detail?.pages) ? detail.pages : [];
  return {
    id: detail?.id || detail?.contentId || null,
    title: detail?.title || null,
    valid_from: detail?.validFrom || null,
    valid_until: detail?.validUntil || null,
    page_count: detail?.pageCount || pages.length || null,
    pdf_url: detail?.pdfUrl || detail?.downloadUrl || detail?.documentUrl || null,
    image: detail?.brochureImage?.url || detail?.previewUrls?.largePreview || null,
    keys: detail && typeof detail === 'object' ? Object.keys(detail).slice(0, 80) : [],
    first_page: pages[0] ? {
      keys: Object.keys(pages[0]).slice(0, 50),
      number: pages[0].pageNumber ?? pages[0].number ?? pages[0].index ?? null,
      image_urls: pages[0].imageUrls || pages[0].images || pages[0].image || null,
    } : null,
  };
}
Deno.serve(async () => {
  const page = await fetchResponse(SOURCE_URL);
  const authKey = page.text.match(/discBonialWidgetId([a-f0-9]{16,64})/i)?.[1] || '';
  if (!authKey) return Response.json({ error: 'OBI Bonial auth key not found' }, { status: 502 });
  const paramsResponse = await fetchResponse(`https://bonialconnect.com/params/connect/v1/keys/${authKey}/encoded.json?_=${Date.now()}`, { ...HEADERS, accept: 'application/json', referer: SOURCE_URL });
  const envelope = JSON.parse(paramsResponse.text);
  const params = typeof envelope.data === 'string' ? decodeBase64Json(envelope.data) : envelope.data;
  const publisherId = /^[A-Z]{2}-/i.test(String(params.publisherId || '')) ? String(params.publisherId) : `${String(params.market || 'de').toUpperCase()}-${String(params.publisherId || '')}`;
  const apiBase = `${String(params.apiHost || '').replace(/\/$/, '')}/${String(params.market || 'de')}`;
  const apiHeaders = { ...HEADERS, accept: 'application/json', referer: SOURCE_URL, 'Bonial-Api-Consumer': 'Bonial-Connect-Widget', 'X-Auth-Key': authKey };
  const storesResponse = await fetchResponse(`${apiBase}/stores/default/byPublisher?publisherId=${encodeURIComponent(publisherId)}`, apiHeaders);
  const stores = JSON.parse(storesResponse.text);
  const store = Array.isArray(stores) ? stores[0] : stores;
  if (!store?.id) return Response.json({ error: 'OBI default store not found' }, { status: 502 });
  const brochuresResponse = await fetchResponse(`${apiBase}/stores/${encodeURIComponent(store.id)}/brochures?publisherId=${encodeURIComponent(publisherId)}&limit=100`, apiHeaders);
  const brochureEnvelope = JSON.parse(brochuresResponse.text);
  const brochures = Array.isArray(brochureEnvelope) ? brochureEnvelope : brochureEnvelope.brochures || [];
  const details = [];
  for (const brochure of brochures.slice(0, 8)) {
    const detailResponse = await fetchResponse(`${apiBase}/v5/brochureDetails/${encodeURIComponent(brochure.id)}?publisherId=${encodeURIComponent(publisherId)}`, apiHeaders);
    let detail: any = null;
    try { detail = JSON.parse(detailResponse.text); } catch { detail = { raw: detailResponse.text.slice(0, 3000) }; }
    details.push({ status: detailResponse.status, brochure: { id: brochure.id, title: brochure.title, page_count: brochure.pageCount, valid_from: brochure.validFrom, valid_until: brochure.validUntil, cover: brochure.brochureImage?.url }, detail: summarizeDetail(detail) });
  }
  return Response.json({ ok: true, auth_key: authKey, publisher_id: publisherId, api_base: apiBase, store: { id: store.id, name: store.name }, details });
});
