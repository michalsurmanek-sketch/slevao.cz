const SOURCE_URL = 'https://www.obi.cz/nabidky/aktualni-letak';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
function decode(value: string) { return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\\u002F/gi, '/').replace(/\\\//g, '/'); }
function compact(value: string) { return decode(value).replace(/\s+/g, ' ').trim(); }
function around(value: string, marker: string, before = 1000, after = 5000) {
  const index = value.toLowerCase().indexOf(marker.toLowerCase());
  return index < 0 ? '' : compact(value.slice(Math.max(0, index - before), Math.min(value.length, index + after))).slice(0, 9000);
}
async function fetchText(url: string, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    return { status: response.status, url: response.url, text: await response.text() };
  } finally { clearTimeout(timer); }
}
Deno.serve(async () => {
  const page = await fetchText(SOURCE_URL, 15000);
  const html = page.text;
  const assetUrls = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)].map((match) => {
    try { return new URL(decode(match[1]), page.url).toString(); } catch { return ''; }
  }).filter(Boolean))].slice(0, 80);
  const matches: Array<{url:string;status:number;bonial:string;auth:string;connect:string;urls:string[]}> = [];
  for (let offset = 0; offset < assetUrls.length; offset += 8) {
    const batch = await Promise.all(assetUrls.slice(offset, offset + 8).map(async (url) => {
      try {
        const asset = await fetchText(url, 12000);
        if (!/(BonialWidget|bonialconnect|59958d8381990c15dda21230|authKey)/i.test(asset.text)) return null;
        return {
          url,
          status: asset.status,
          bonial: around(asset.text, 'BonialWidget'),
          auth: around(asset.text, 'authKey'),
          connect: around(asset.text, 'bonialconnect'),
          urls: [...new Set([...asset.text.matchAll(/https?:\\?\/\\?\/[^"'`<>\s)]+/gi)].map((match) => decode(match[0]).replace(/[;,]+$/, '')))].slice(0, 40),
        };
      } catch { return null; }
    }));
    matches.push(...batch.filter((value): value is NonNullable<typeof value> => Boolean(value)));
  }
  return Response.json({
    status: page.status,
    final_url: page.url,
    html_length: html.length,
    auth_key_snippet: around(html, '59958d8381990c15dda21230', 2500, 6000),
    bonial_snippet: around(html, 'BonialWidget', 2500, 6000),
    asset_count: assetUrls.length,
    matching_assets: matches,
  });
});
