const SOURCE_URL = 'https://www.intersport.cz/akce/';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function compact(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/\s+/g, ' ').trim();
}

function around(html: string, marker: string) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - 1800), Math.min(html.length, index + 6000))).slice(0, 10000);
}

Deno.serve(async () => {
  const response = await fetch(SOURCE_URL, { headers: HEADERS, redirect: 'follow' });
  const html = await response.text();
  const urls = [...new Set([
    ...html.matchAll(/(?:href|src|data-src)=["']([^"']+)["']/gi),
  ].map((match) => match[1]).filter((url) => /(?:\.pdf(?:$|\?)|letak|leták|prospekt|katalog|akce|campaign|product)/i.test(url)))].slice(0, 150);
  return Response.json({
    status: response.status,
    final_url: response.url,
    length: html.length,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
    urls,
    dates: [...new Set([...html.matchAll(/\d{1,2}[./]\d{1,2}[./](?:20\d{2})?|20\d{2}-\d{2}-\d{2}/g)].map((match) => match[0]))].slice(0, 80),
    snippets: {
      letak: around(html, 'leták'),
      akce: around(html, 'akce'),
      product: around(html, 'product'),
      pdf: around(html, '.pdf'),
      jsonld: around(html, 'application/ld+json'),
    },
  });
});
