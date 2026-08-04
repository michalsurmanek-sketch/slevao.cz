import { writeFile } from 'node:fs/promises';

const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
const PAGE_SIZE = 1000;

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function fetchProducts() {
  const products = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = new URLSearchParams({
      select: 'id,updated_at',
      is_active: 'eq.true',
      order: 'updated_at.desc.nullslast'
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/products?${query}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
        Prefer: 'count=exact'
      }
    });
    if (!response.ok) {
      throw new Error(`Supabase products request failed: ${response.status} ${await response.text()}`);
    }
    const rows = await response.json();
    products.push(...rows);
    if (rows.length < PAGE_SIZE) break;
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
