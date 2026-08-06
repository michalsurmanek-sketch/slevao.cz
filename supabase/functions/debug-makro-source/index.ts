const SOURCE_URL = 'https://sortiment.makro.cz/cs/catalog/category/action';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function decode(value: string) {
  return value.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"');
}

function compact(value: string) {
  return value.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/\s+/g, ' ').trim();
}

function around(html: string, marker: string, before = 1800, after = 7000) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after))).slice(0, 12000);
}

Deno.serve(async () => {
  const response = await fetch(SOURCE_URL, { headers: HEADERS, redirect: 'follow' });
  const html = await response.text();
  const normalized = decode(html);
  const scripts = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => decode(match[1])))].slice(0, 80);
  const urls = [...new Set([
    ...normalized.matchAll(/https?:\/\/[^"'<>\s]+/gi),
  ].map((match) => match[0]).filter((url) => /(?:api|graphql|catalog|product|promotion|action|offer|search)/i.test(url)))].slice(0, 150);
  const productPaths = [...new Set([
    ...normalized.matchAll(/\/cs\/[^"'<>\s]+\/\d+p\/?/gi),
  ].map((match) => match[0]))].slice(0, 100);

  return Response.json({
    status: response.status,
    final_url: response.url,
    length: html.length,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
    scripts,
    urls,
    product_paths: productPaths,
    dates: [...new Set([...normalized.matchAll(/20\d{2}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]20\d{2}/g)].map((match) => match[0]))].slice(0, 100),
    snippets: {
      next: around(normalized, '__NEXT_DATA__'),
      nuxt: around(normalized, '__NUXT__'),
      graphql: around(normalized, 'graphql'),
      api: around(normalized, '/api/'),
      product: around(normalized, 'product'),
      price: around(normalized, 'price'),
      action: around(normalized, 'action'),
    },
  });
});
