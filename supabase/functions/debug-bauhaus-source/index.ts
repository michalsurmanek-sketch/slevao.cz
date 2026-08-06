const SOURCE_URL = 'https://www.bauhaus.cz/katalogy';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
function decode(value: string) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
}
function compact(value: string) {
  return decode(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function around(html: string, marker: string, before = 2200, after = 8500) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after))).slice(0, 14000);
}
Deno.serve(async () => {
  const response = await fetch(SOURCE_URL, { headers: HEADERS, redirect: 'follow' });
  const html = await response.text();
  const raw = [
    ...[...html.matchAll(/(?:href|src|data-src|data-url|content)=["']([^"']+)["']/gi)].map((match) => decode(match[1])),
    ...[...html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)].map((match) => decode(match[0])),
  ];
  const absolute = [...new Set(raw.map((value) => { try { return new URL(value, response.url).toString(); } catch { return ''; } }).filter(Boolean))];
  return Response.json({
    status: response.status,
    final_url: response.url,
    html_length: html.length,
    title: compact(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    document_links: absolute.filter((url) => /(?:\.pdf(?:$|\?)|katalog|catalog|letak|leaflet|prospekt|flipbook|viewer|issuu)/i.test(url)).slice(0, 250),
    product_links: absolute.filter((url) => /bauhaus\.cz\/[a-z0-9-]+-\d{6,}/i.test(url)).slice(0, 80),
    dates: [...new Set([...html.matchAll(/(?:\b\d{1,2}[.]\s*\d{1,2}[.]?(?:\s*20\d{2})?\s*(?:až|[-–])\s*\d{1,2}[.]\s*\d{1,2}[.]?(?:\s*20\d{2})?\b|20\d{2}-\d{2}-\d{2})/gi)].map((match) => match[0]))].slice(0, 100),
    snippets: {
      current: around(html, 'Aktuální katalog'),
      validity: around(html, 'Platnost katalogu'),
      pdf: around(html, '.pdf'),
      flipbook: around(html, 'flipbook'),
      catalog: around(html, 'catalog'),
      next_data: around(html, '__NEXT_DATA__'),
      apollo: around(html, '__APOLLO_STATE__'),
    },
  });
});
