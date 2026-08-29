import { writeFile } from 'node:fs/promises';

const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(afterId = '') {
  const query = new URLSearchParams({
    select: 'id,updated_at',
    is_active: 'eq.true',
    order: 'id.asc',
    limit: String(PAGE_SIZE)
  });
  if (afterId) query.set('id', `gt.${afterId}`);

  const url = `${SUPABASE_URL}/rest/v1/products?${query}`;
  let lastFailure = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        },
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(1000 * (2 ** (attempt - 1)));
      continue;
    }

    if (response.ok) return response.json();

    const body = await response.text();
    lastFailure = `${response.status} ${body}`;
    const statementTimeout = response.status === 500 && body.includes('57014');
    if ((!RETRYABLE_STATUS.has(response.status) && !statementTimeout) || attempt === MAX_ATTEMPTS) break;
    await sleep(1000 * (2 ** (attempt - 1)));
  }

  throw new Error(`Supabase products request failed after ${MAX_ATTEMPTS} attempts: ${lastFailure}`);
}

async function fetchProducts() {
  const products = [];
  const seen = new Set();
  let afterId = '';

  for (;;) {
    const rows = await fetchPage(afterId);
    if (!Array.isArray(rows)) throw new Error('Supabase products response is not an array.');

    for (const row of rows) {
      const id = String(row?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      products.push(row);
    }

    if (rows.length < PAGE_SIZE) break;
    const nextId = String(rows.at(-1)?.id || '').trim();
    if (!nextId || nextId === afterId) throw new Error('Product sitemap pagination did not advance.');
    afterId = nextId;
  }

  return products;
}

const products = await fetchProducts();
const urls = products.map((product) => {
  const location = `https://slevao.cz/produkt.html?id=${encodeURIComponent(product.id)}`;
  const lastmod = product.updated_at ? `\n    <lastmod>${xml(String(product.updated_at).slice(0, 10))}</lastmod>` : '';
  return `  <url>\n    <loc>${xml(location)}</loc>${lastmod}\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`;
});

const output = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
await writeFile('sitemap-products.xml', output, 'utf8');
console.log(`Generated sitemap-products.xml with ${products.length} product URLs.`);
