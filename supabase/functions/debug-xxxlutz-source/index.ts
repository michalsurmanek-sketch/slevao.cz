const CATALOG_URLS = [
  'https://catalog.xxxlutz.cz/frontend/getcatalog.do?catalogId=1346832',
  'https://catalog.xxxlutz.cz/frontend/getcatalog.do?catalogId=1334965',
  'https://catalog.xxxlutz.cz/frontend/getcatalog.do?catalogId=1345671',
];
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
function decode(value: string) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
}
function compact(value: string) { return decode(value).replace(/\s+/g, ' ').trim(); }
function around(html: string, marker: string, before = 2200, after = 7000) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after))).slice(0, 12000);
}
async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    return { status: response.status, url: response.url, text: await response.text() };
  } finally { clearTimeout(timer); }
}
Deno.serve(async () => {
  const results = [];
  for (const url of CATALOG_URLS) {
    const page = await fetchText(url);
    const html = page.text;
    const raw = [
      ...[...html.matchAll(/(?:href|src|data-src|data-url|content)=["']([^"']+)["']/gi)].map((match) => decode(match[1])),
      ...[...html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)].map((match) => decode(match[0])),
    ];
    const links = [...new Set(raw.map((value) => { try { return new URL(value, page.url).toString(); } catch { return ''; } }).filter(Boolean))];
    results.push({
      requested_url: url,
      status: page.status,
      final_url: page.url,
      html_length: html.length,
      title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
      catalog_id: page.url.match(/[?&]catalogId=(\d+)/i)?.[1] || null,
      catalog_version: html.match(/catalogVersion\s*[:=]\s*["']?(\d+)/i)?.[1] || null,
      links: links.filter((item) => /(?:\.pdf(?:$|\?)|\/catalogs\/|complete|download|archive|overview|list|api|json|xml)/i.test(item)).slice(0, 160),
      scripts: links.filter((item) => /\.js(?:$|\?)/i.test(item)).slice(0, 80),
      snippets: {
        complete_pdf: around(html, 'complete.pdf'),
        catalog_version: around(html, 'catalogVersion'),
        catalog_id: around(html, 'catalogId'),
        pdf: around(html, '.pdf'),
        frontend: around(html, '/frontend/'),
        archive: around(html, 'archive'),
      },
    });
  }
  return Response.json({ results });
});
