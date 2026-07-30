from pathlib import Path
import re

path = Path("supabase/functions/process-leaflet/index.ts")
text = path.read_text(encoding="utf-8")

marker = "async function processImport(importId: string) {"
helper = """async function fetchTescoDocument(url: string): Promise<Response> {
  const landingUrl = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
  const browserHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/pdf,image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
    'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  };

  const landing = await fetch(landingUrl, {
    headers: browserHeaders,
    redirect: 'follow',
  });
  const cookies = landing.headers.getSetCookie?.() || [];
  const cookie = cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');

  const response = await fetch(url, {
    headers: {
      ...browserHeaders,
      accept: 'application/pdf,image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      referer: landingUrl,
      ...(cookie ? { cookie } : {}),
    },
    redirect: 'follow',
  });
  if (response.ok) return response;

  return await fetch(url, {
    headers: {
      ...browserHeaders,
      accept: 'application/pdf,*/*;q=0.8',
      referer: 'https://www.itesco.cz/',
      origin: 'https://www.itesco.cz',
      ...(cookie ? { cookie } : {}),
    },
    redirect: 'follow',
  });
}

"""

if "async function fetchTescoDocument(" not in text:
    if marker not in text:
        raise SystemExit("processImport marker not found")
    text = text.replace(marker, helper + marker, 1)

pattern = re.compile(
    r"    const sourceResponse = await fetch\(job\.source_document_url, \{[\s\S]*?\n    \}\);\n    if \(!sourceResponse\.ok\)",
    re.M,
)
replacement = """    const sourceResponse = job.stores?.slug === 'tesco'
      ? await fetchTescoDocument(job.source_document_url)
      : await fetch(job.source_document_url, {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
            accept: 'text/html,application/xhtml+xml,application/pdf,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
            'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
            referer: job.source_document_url.includes('gapi.globus.cz')
              ? 'https://www.globus.cz/'
              : new URL(job.source_document_url).origin + '/',
          },
          redirect: 'follow',
        });
    if (!sourceResponse.ok)"""

text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"Could not patch sourceResponse block; matches={count}")

path.write_text(text, encoding="utf-8")
