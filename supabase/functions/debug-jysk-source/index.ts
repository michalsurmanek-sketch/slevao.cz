const SOURCE_URL = 'https://jysk.cz/campaign';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function around(html: string, marker: string, before = 1200, after = 5000) {
  const index = html.toLocaleLowerCase('cs').indexOf(marker.toLocaleLowerCase('cs'));
  return index < 0 ? '' : compact(html.slice(Math.max(0, index - before), Math.min(html.length, index + after)));
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    return { status: response.status, finalUrl: response.url, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async () => {
  const listing = await fetchText(SOURCE_URL);
  const publications = [...new Set(
    [...listing.text.matchAll(/https:\/\/ipaper\.ipapercms\.dk\/jysk\/cz\/CampaignPaper\/[a-z0-9_]+(?:\?[^"'<>\s]*)?/gi)]
      .map((match) => match[0].replace(/&amp;/gi, '&').replace(/\?page=\d+.*$/i, '')),
  )];

  const details = [];
  for (const publication of publications.slice(0, 5)) {
    const page = await fetchText(publication);
    const candidateUrls = [...new Set([
      ...page.text.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi),
    ].map((match) => match[0].replace(/\\\//g, '/').replace(/&amp;/gi, '&'))
      .filter((url) => /(?:\.pdf(?:$|\?)|download|thumbnail|pageimage|publication)/i.test(url)))].slice(0, 80);
    details.push({
      publication,
      status: page.status,
      final_url: page.finalUrl,
      length: page.text.length,
      title: page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
      og_title: page.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || null,
      og_image: page.text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null,
      dates: [...new Set([...page.text.matchAll(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[./]\d{1,2}[./]20\d{2}/g)].map((match) => match[0]))].slice(0, 30),
      candidate_urls: candidateUrls,
      publication_snippet: around(page.text, 'publication'),
      download_snippet: around(page.text, 'download'),
      pdf_snippet: around(page.text, '.pdf'),
    });
  }

  return Response.json({
    listing_status: listing.status,
    listing_url: listing.finalUrl,
    publications,
    details,
  });
});
