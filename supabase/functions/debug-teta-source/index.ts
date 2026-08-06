const DETAIL_URL = 'https://www.tetadrogerie.cz/akce/detail/ed26140001';

function compact(value: string) {
  return value
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const listStart = html.indexOf('<div class="c-product-list');
  const listEnd = html.indexOf('c-pagination', listStart);
  const listHtml = listStart >= 0 ? html.slice(listStart, listEnd > listStart ? listEnd : listStart + 300_000) : '';
  const cardStarts = [...listHtml.matchAll(/<div class="c-product-card c-product-card--list"/g)].map((match) => match.index || 0);
  const cards = cardStarts.slice(0, 3).map((start, index) => {
    const end = cardStarts[index + 1] ?? Math.min(listHtml.length, start + 20_000);
    return compact(listHtml.slice(start, end)).slice(0, 12_000);
  });
  const nuxtMatch = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  return Response.json({
    status: response.status,
    final_url: response.url,
    length: html.length,
    card_count: cardStarts.length,
    cards,
    nuxt_length: nuxtMatch?.[1]?.length || 0,
  });
});
