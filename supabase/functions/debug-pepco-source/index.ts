const SOURCE_URL = 'https://pepco.cz/kolekce/letaky/';

function compact(value: string) {
  return value
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const markers = [
    '<h1',
    'nabídce od',
    '/products/',
    'product-card',
    'productCard',
    'price',
    'currency',
    '__NEXT_DATA__',
    'application/ld+json',
  ];
  const snippets: Record<string, string[]> = {};
  for (const marker of markers) {
    const values: string[] = [];
    let cursor = 0;
    while (values.length < 6) {
      const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'), cursor);
      if (index < 0) break;
      values.push(compact(html.slice(Math.max(0, index - 1800), Math.min(html.length, index + 4200))).slice(0, 8000));
      cursor = index + marker.length;
    }
    snippets[marker] = values;
  }

  const links = [...new Set(
    [...html.matchAll(/href=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((url) => /pepco\.cz\/(?:produkt|product|produkty|products)\//i.test(url) || /^\/(?:produkt|product|produkty|products)\//i.test(url)),
  )].slice(0, 100);
  const productSnippets = links.slice(0, 5).map((link) => {
    const index = html.indexOf(`href=\\"${link}\\"`) >= 0
      ? html.indexOf(`href=\\"${link}\\"`)
      : html.indexOf(`href="${link}"`);
    return { link, snippet: index >= 0 ? compact(html.slice(Math.max(0, index - 3000), index + 7000)).slice(0, 12_000) : '' };
  });

  return Response.json({
    status: response.status,
    final_url: response.url,
    length: html.length,
    links,
    productSnippets,
    snippets,
  });
});
