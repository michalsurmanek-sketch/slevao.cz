const SOURCE_URL = 'https://jysk.cz/campaign';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function compact(value: string) {
  return value
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(value: string) {
  return value
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"');
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    return { status: response.status, url: response.url, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function snippetsAround(html: string, markers: string[], limit = 5) {
  const output: Record<string, string[]> = {};
  const lower = html.toLocaleLowerCase('cs');
  for (const marker of markers) {
    const values: string[] = [];
    let cursor = 0;
    while (values.length < limit) {
      const index = lower.indexOf(marker.toLocaleLowerCase('cs'), cursor);
      if (index < 0) break;
      values.push(compact(html.slice(Math.max(0, index - 2200), Math.min(html.length, index + 5200))).slice(0, 10_000));
      cursor = index + marker.length;
    }
    output[marker] = values;
  }
  return output;
}

Deno.serve(async () => {
  const campaign = await fetchHtml(SOURCE_URL);
  const html = campaign.html;
  const productMap = new Map<string, { id: string | null; title: string; url: string }>();

  for (const match of html.matchAll(/"id":"([^"]+)"[\s\S]{0,500}?"url":"([^"]+)"[\s\S]{0,500}?"title":"([^"]+)"/g)) {
    const url = decode(match[2]);
    if (!url.startsWith('/') || /(?:campaign|customer-service|inspiration|stores)/i.test(url)) continue;
    productMap.set(url, { id: match[1], title: decode(match[3]), url });
  }
  for (const match of html.matchAll(/"url":"([^"]+)"[\s\S]{0,500}?"title":"([^"]+)"[\s\S]{0,500}?"identifier":"([^"]+)"/g)) {
    const url = decode(match[1]);
    if (!url.startsWith('/') || /(?:campaign|customer-service|inspiration|stores)/i.test(url)) continue;
    productMap.set(url, { id: match[3], title: decode(match[2]), url });
  }

  const products = [...productMap.values()].slice(0, 8);
  const details = [];
  for (const product of products.slice(0, 4)) {
    try {
      const detail = await fetchHtml(new URL(product.url, SOURCE_URL).toString());
      details.push({
        product,
        status: detail.status,
        final_url: detail.url,
        snippets: snippetsAround(detail.html, [
          'application/ld+json',
          'product:price:amount',
          'og:image',
          'sales-price',
          'current-price',
          'price__value',
          'data-price',
          'kr',
        ], 3),
      });
    } catch (error) {
      details.push({ product, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return Response.json({
    status: campaign.status,
    final_url: campaign.url,
    length: html.length,
    product_count: productMap.size,
    products,
    campaign_snippets: snippetsAround(html, [
      'field_catalog_pages_featured_products',
      'field_catalog_pages_list_products',
      'field_catalog_from',
      'field_catalog_to',
      'current-manual',
      'expires=',
      'senzační nabídky',
    ]),
    details,
  });
});
