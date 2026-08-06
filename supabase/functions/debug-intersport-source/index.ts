const SOURCE_URL = 'https://www.intersport.cz/akce/';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function compact(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function around(html: string, marker: string, before = 1800, after = 6000) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after))).slice(0, 10000);
}

async function fetchPage(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    return { status: response.status, url: response.url, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function decodePath(value: string) {
  return value
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

function absolute(value: string, base: string) {
  try { return new URL(decodePath(value), base).toString(); } catch { return null; }
}

function campaignPaths(html: string) {
  const normalized = decodePath(html);
  return [...new Set(
    [...normalized.matchAll(/\/akce\/([a-z0-9_-]{3,100})\/?/gi)]
      .map((match) => `/akce/${match[1]}`)
      .filter((path) => !/\/(?:akce|page)$/i.test(path)),
  )];
}

Deno.serve(async () => {
  const listing = await fetchPage(SOURCE_URL);
  const campaignUrls = campaignPaths(listing.html)
    .map((path) => absolute(path, listing.url))
    .filter((url): url is string => Boolean(url) && url !== SOURCE_URL)
    .slice(0, 16);

  const details = [];
  for (const campaignUrl of campaignUrls.slice(0, 6)) {
    try {
      const page = await fetchPage(campaignUrl);
      const normalized = decodePath(page.html);
      const productUrls = [...new Set(
        [...normalized.matchAll(/(?:href=["']|"url"\s*:\s*")([^"']+)["']/gi)]
          .map((match) => absolute(match[1], page.url))
          .filter((url): url is string => Boolean(url) && /\/p\//i.test(url)),
      )].slice(0, 30);
      details.push({
        url: campaignUrl,
        status: page.status,
        final_url: page.url,
        title: compact(page.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
          || page.html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
          || null,
        image: page.html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
          || page.html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
          || null,
        product_count: productUrls.length,
        product_urls: productUrls,
        prices: [...new Set([...normalized.matchAll(/\b\d{1,5}(?:[ ,.][0-9]{2})?\s*Kč\b/gi)].map((match) => compact(match[0])))].slice(0, 40),
        dates: [...new Set([...normalized.matchAll(/\d{1,2}[./]\d{1,2}[./](?:20\d{2})?|20\d{2}-\d{2}-\d{2}/g)].map((match) => match[0]))].slice(0, 40),
        snippets: {
          platnost: around(page.html, 'platí'),
          kc: around(normalized, 'Kč'),
          product: around(normalized, '/p/'),
          jsonld: around(page.html, 'application/ld+json'),
        },
      });
    } catch (error) {
      details.push({ url: campaignUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return Response.json({
    listing_status: listing.status,
    listing_url: listing.url,
    campaign_count: campaignUrls.length,
    campaign_urls: campaignUrls,
    details,
  });
});
