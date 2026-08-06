const SOURCE_URL = 'https://www.terno.cz/prodejny/zlin/';

function decode(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/\\\//g, '/');
}

Deno.serve(async () => {
  const response = await fetch(SOURCE_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'cs-CZ,cs;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await response.text();
  const urls = new Set<string>();
  for (const match of html.matchAll(/(?:href|src|data-pdf|data-source|url)[=:]["']?([^"'<>\s)]+)/gi)) {
    const value = decode(match[1]);
    if (/\.pdf(?:$|\?)/i.test(value) || /(letak|leaflet|prospekt|katalog|brochure)/i.test(value)) urls.add(value);
  }
  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)) {
    const value = decode(match[0]);
    if (/\.pdf(?:$|\?)/i.test(value) || /(letak|leaflet|prospekt|katalog|brochure)/i.test(value)) urls.add(value);
  }
  const markers = ['Zpátky do školy', 'Nabídka pro věrné zákazníky', 'Akční nabídka', '.pdf', 'dflip', 'real3dflipbook', 'flowpaper'];
  const snippets: Record<string, string[]> = {};
  for (const marker of markers) {
    const values: string[] = [];
    let cursor = 0;
    while (values.length < 5) {
      const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'), cursor);
      if (index < 0) break;
      values.push(html.slice(Math.max(0, index - 800), Math.min(html.length, index + 1800)).replace(/\s+/g, ' '));
      cursor = index + marker.length;
    }
    snippets[marker] = values;
  }
  return Response.json({ status: response.status, final_url: response.url, length: html.length, urls: [...urls].slice(0, 100), snippets });
});
