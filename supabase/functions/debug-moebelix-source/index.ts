const SOURCE_URL = 'https://www.moebelix.cz/prospekty/aktu%C3%A1ln%C3%AD-let%C3%A1ky';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function decode(value: string) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');
}

function compact(value: string) {
  return decode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

Deno.serve(async () => {
  const response = await fetch(SOURCE_URL, { headers: HEADERS, redirect: 'follow' });
  const html = await response.text();
  const links = [...new Set([
    ...[...html.matchAll(/(?:href|src|data-src|data-url)=["']([^"']+)["']/gi)].map((match) => decode(match[1])),
    ...[...html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)].map((match) => decode(match[0])),
  ].map((value) => {
    try { return new URL(value, response.url).toString(); } catch { return ''; }
  }).filter((url) => /(?:catalog\.moebelix\.cz|\.pdf(?:$|\?)|prospekt|letak|leaflet|katalog)/i.test(url)))].slice(0, 160);

  const dates = [...new Set([
    ...html.matchAll(/\b\d{1,2}[.]\d{1,2}[.]\d{4}\s*[-–]\s*\d{1,2}[.]\d{1,2}[.]\d{4}\b/g),
  ].map((match) => match[0]))].slice(0, 60);

  const markers = ['Prolistovat online', 'Letáky na stažení v PDF', 'catalog.moebelix.cz', '.pdf', 'MCZ', 'Garden-katalog'];
  const snippets: Record<string, string[]> = {};
  for (const marker of markers) {
    const values: string[] = [];
    let cursor = 0;
    while (values.length < 6) {
      const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'), cursor);
      if (index < 0) break;
      values.push(compact(html.slice(Math.max(0, index - 2500), Math.min(html.length, index + 8000))).slice(0, 12000));
      cursor = index + marker.length;
    }
    snippets[marker] = values;
  }

  return Response.json({
    status: response.status,
    final_url: response.url,
    html_length: html.length,
    title: compact(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    links,
    dates,
    snippets,
  });
});
