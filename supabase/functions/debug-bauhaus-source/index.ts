const SOURCE_URL = 'https://www.bauhaus.cz/katalogy';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
function decode(value: string) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
}
function compact(value: string) { return decode(value).replace(/\s+/g, ' ').trim(); }
function around(html: string, marker: string, before = 2200, after = 8500) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after))).slice(0, 14000);
}
async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    return { status: response.status, url: response.url, text: await response.text() };
  } finally { clearTimeout(timer); }
}
function absoluteLinks(html: string, base: string) {
  const raw = [
    ...[...html.matchAll(/(?:href|src|data-src|data-url|content)=["']([^"']+)["']/gi)].map((match) => decode(match[1])),
    ...[...html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)].map((match) => decode(match[0])),
  ];
  return [...new Set(raw.map((value) => { try { return new URL(value, base).toString(); } catch { return ''; } }).filter(Boolean))];
}
Deno.serve(async () => {
  const listing = await fetchText(SOURCE_URL);
  const currentUrl = absoluteLinks(listing.text, listing.url).find((url) => /^https:\/\/katalogy\.bauhaus\.cz\/katalog-[^/?#]+\/?$/i.test(url)) || '';
  if (!currentUrl) return Response.json({ error: 'Current BAUHAUS catalog URL not found', listing_status: listing.status }, { status: 502 });
  const viewer = await fetchText(currentUrl);
  const links = absoluteLinks(viewer.text, viewer.url);
  const scripts = links.filter((url) => /\.js(?:$|\?)/i.test(url)).slice(0, 100);
  return Response.json({
    listing_status: listing.status,
    listing_url: listing.url,
    current_url: currentUrl,
    listing_validity: around(listing.text, 'Platnost katalogu', 1800, 5000),
    viewer_status: viewer.status,
    viewer_url: viewer.url,
    viewer_length: viewer.text.length,
    viewer_title: viewer.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
    og_title: viewer.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || null,
    og_image: viewer.text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null,
    links: links.filter((url) => /(?:\.pdf(?:$|\?)|complete|download|page|pages|catalog|katalog|json|xml|manifest|config)/i.test(url)).slice(0, 250),
    scripts,
    snippets: {
      pdf: around(viewer.text, '.pdf'),
      download: around(viewer.text, 'download'),
      page: around(viewer.text, 'page'),
      config: around(viewer.text, 'config'),
      manifest: around(viewer.text, 'manifest'),
      flipbook: around(viewer.text, 'flipbook'),
    },
  });
});
