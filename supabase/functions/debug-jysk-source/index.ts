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

function snippetsAround(html: string, markers: string[], limit = 3) {
  const output: Record<string, string[]> = {};
  const lower = html.toLocaleLowerCase('cs');
  for (const marker of markers) {
    const values: string[] = [];
    let cursor = 0;
    while (values.length < limit) {
      const index = lower.indexOf(marker.toLocaleLowerCase('cs'), cursor);
      if (index < 0) break;
      values.push(compact(html.slice(Math.max(0, index - 1800), Math.min(html.length, index + 4200))).slice(0, 8000));
      cursor = index + marker.length;
    }
    output[marker] = values;
  }
  return output;
}

function traverse(value: unknown, path: string, products: Map<string, any>, dates: any[], campaignNodes: any[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => traverse(item, `${path}[${index}]`, products, dates, campaignNodes));
    return;
  }

  const record = value as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url : null;
  const title = typeof record.title === 'string' ? record.title : null;
  const identifier = typeof record.identifier === 'string' || typeof record.identifier === 'number'
    ? String(record.identifier)
    : (typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : null);
  if (url?.startsWith('/') && title && identifier && !/(campaign|customer-service|inspiration|stores)/i.test(url)) {
    products.set(url, {
      path,
      id: identifier,
      title,
      url,
      price: record.price ?? null,
      image: record.image ?? record.images ?? null,
      keys: Object.keys(record),
    });
  }

  const interestingDateKeys = Object.keys(record).filter((key) => /(from|to|start|end|valid|date|expire)/i.test(key));
  if (interestingDateKeys.length) {
    dates.push({ path, values: Object.fromEntries(interestingDateKeys.map((key) => [key, record[key]])) });
  }
  if (/catalog|campaign|manual/i.test(path) || Object.keys(record).some((key) => /catalog|campaign|manual/i.test(key))) {
    campaignNodes.push({ path, keys: Object.keys(record), sample: record });
  }

  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'object' && child !== null) traverse(child, path ? `${path}.${key}` : key, products, dates, campaignNodes);
  }
}

Deno.serve(async () => {
  const campaign = await fetchHtml(SOURCE_URL);
  const scripts = [...campaign.html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const products = new Map<string, any>();
  const dates: any[] = [];
  const campaignNodes: any[] = [];
  const parseErrors: string[] = [];

  scripts.forEach((match, index) => {
    try {
      const parsed = JSON.parse(match[1].trim());
      traverse(parsed, `script[${index}]`, products, dates, campaignNodes);
    } catch (error) {
      parseErrors.push(`script[${index}]: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const productList = [...products.values()].slice(0, 12);
  const details = [];
  for (const product of productList.slice(0, 4)) {
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
        ]),
      });
    } catch (error) {
      details.push({ product, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return Response.json({
    status: campaign.status,
    final_url: campaign.url,
    length: campaign.html.length,
    json_script_count: scripts.length,
    parse_errors: parseErrors,
    product_count: products.size,
    products: productList,
    date_nodes: dates.slice(0, 80),
    campaign_nodes: campaignNodes.slice(-20).map((node) => ({
      path: node.path,
      keys: node.keys,
      sample: JSON.stringify(node.sample).slice(0, 12_000),
    })),
    details,
  });
});
