const SOURCE_URL = 'https://jysk.cz/campaign';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function around(html: string, marker: string, before = 1200, after = 18000) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after)));
}

Deno.serve(async () => {
  const response = await fetch(SOURCE_URL, { headers: HEADERS, redirect: 'follow' });
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);

  const targetScript = scripts.find((script) => /field_catalog_pages_(?:featured|list)_products|current-manual/i.test(script)) || '';
  const escapedUrlCount = (targetScript.match(/\\"url\\"/g) || []).length;
  const plainUrlCount = (targetScript.match(/"url"/g) || []).length;

  return Response.json({
    status: response.status,
    final_url: response.url,
    html_length: html.length,
    script_count: scripts.length,
    target_script_length: targetScript.length,
    escaped_url_count: escapedUrlCount,
    plain_url_count: plainUrlCount,
    featured: around(targetScript || html, 'field_catalog_pages_featured_products'),
    listed: around(targetScript || html, 'field_catalog_pages_list_products'),
    current_manual: around(targetScript || html, 'current-manual', 1000, 8000),
    catalog_from: around(targetScript || html, 'field_catalog_from', 1000, 5000),
    catalog_to: around(targetScript || html, 'field_catalog_to', 1000, 5000),
    dates: [...new Set([
      ...html.matchAll(/20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?)?/g),
    ].map((match) => match[0]))].slice(0, 50),
  });
});
