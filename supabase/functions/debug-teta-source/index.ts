const DETAIL_URL = 'https://www.tetadrogerie.cz/akce/detail/ed26140001';

Deno.serve(async () => {
  const response = await fetch(DETAIL_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'cs-CZ,cs;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await response.text();
  const markers = ['/eshop/katalog/', 'product-card', 'productCard', 'data-product', '__NEXT_DATA__', '__NUXT_DATA__'];
  const snippets: Record<string, string[]> = {};
  for (const marker of markers) {
    const values: string[] = [];
    let cursor = 0;
    while (values.length < 4) {
      const index = html.indexOf(marker, cursor);
      if (index < 0) break;
      values.push(html.slice(Math.max(0, index - 900), Math.min(html.length, index + 1800)));
      cursor = index + marker.length;
    }
    snippets[marker] = values;
  }
  return Response.json({
    status: response.status,
    final_url: response.url,
    length: html.length,
    snippets,
  });
});
