(() => {
  'use strict';

  const config = window.SLEVAO_STORE || {};
  if (config.slug !== 'globus') return;

  const nativeFetch = window.fetch.bind(window);
  const SUPABASE_ORIGIN = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const DOCUMENT_PATH = '/functions/v1/store-leaflet-document';
  const generatedDocuments = new Map();
  const decoder = new TextDecoder();

  function requestUrl(input) {
    try {
      const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
      return new URL(String(value || ''), location.href);
    } catch {
      return null;
    }
  }

  function isLeafletDocumentRequest(url) {
    return url?.origin === SUPABASE_ORIGIN && url.pathname === DOCUMENT_PATH;
  }

  function normalizeSource(value) {
    return String(value || '')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&');
  }

  function pageUrls(html) {
    const source = normalizeSource(html);
    const matches = source.match(/https:\/\/action-offers\.globus\.cz\/[a-z0-9][a-z0-9/_?=&.%:#-]*/gi) || [];
    const urls = [];
    const seen = new Set();

    for (const rawValue of matches) {
      try {
        const url = new URL(rawValue.replace(/[),.;]+$/, ''));
        if (url.protocol !== 'https:' || url.hostname !== 'action-offers.globus.cz') continue;
        const value = url.toString();
        if (seen.has(value)) continue;
        seen.add(value);
        urls.push(value);
      } catch {
        // Neplatné hodnoty ze zdrojového HTML se přeskočí.
      }
    }

    if (urls.length < 2) throw new Error('Globus nevrátil jednotlivé strany aktuálního letáku.');
    return urls;
  }

  function escapeAttribute(value) {
    return String(value).replace(/[&"<>]/g, (character) => ({
      '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;',
    }[character]));
  }

  function buildLeafletDocument(urls) {
    const pages = urls.map((url, index) => `
      <figure class="page">
        <img src="${escapeAttribute(url)}" alt="Globus leták – strana ${index + 1}" loading="${index < 2 ? 'eager' : 'lazy'}">
        <figcaption>Strana ${index + 1} z ${urls.length}</figcaption>
      </figure>`).join('');

    return `<!doctype html><html lang="cs"><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <meta name="referrer" content="no-referrer">
      <title>Globus – aktuální leták</title>
      <style>
        :root{color-scheme:light;font-family:Inter,Arial,sans-serif;background:#edf2f1;color:#172321}
        *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;padding:14px;background:#edf2f1}
        .info{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1120px;margin:0 auto 12px;padding:10px 14px;border:1px solid #d6e1df;border-radius:14px;background:rgba(255,255,255,.96);box-shadow:0 5px 20px rgba(20,45,42,.1);font-size:13px;font-weight:800}
        .info strong{color:#d71920;font-size:15px}.pages{max-width:1120px;margin:auto}.page{position:relative;margin:0 0 14px;overflow:hidden;border:1px solid #d6e1df;border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(20,45,42,.1)}
        .page img{display:block;width:100%;height:auto;background:#fff}.page figcaption{position:absolute;right:10px;bottom:10px;padding:6px 9px;border-radius:999px;background:rgba(17,31,29,.82);color:#fff;font-size:11px;font-weight:800}
        @media(max-width:600px){body{padding:0;background:#fff}.info{top:0;margin:0;border-width:0 0 1px;border-radius:0;box-shadow:none}.page{margin:0;border-width:0 0 8px;border-radius:0;box-shadow:none}.page figcaption{right:7px;bottom:14px}}
      </style>
    </head><body>
      <div class="info"><strong>Globus – aktuální leták</strong><span>${urls.length} stran</span></div>
      <main class="pages">${pages}</main>
    </body></html>`;
  }

  function responseFromHtml(html) {
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, max-age=300',
        'x-slevao-globus-viewer': 'pages',
      },
    });
  }

  function looksLikePdf(bytes, contentType) {
    return contentType.includes('application/pdf')
      || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  }

  function looksLikeImage(bytes, contentType) {
    if (contentType.startsWith('image/')) return true;
    return (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
      || (bytes[0] === 0xff && bytes[1] === 0xd8)
      || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46);
  }

  async function inspectResponse(response) {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const buffer = await response.clone().arrayBuffer();
    const bytes = new Uint8Array(buffer.slice(0, 8));

    if (looksLikePdf(bytes, contentType) || looksLikeImage(bytes, contentType)) return null;

    const text = decoder.decode(buffer);
    const trimmed = text.trimStart();
    if (contentType.includes('application/json') || trimmed.startsWith('{')) {
      const payload = JSON.parse(text);
      const sourceUrl = String(payload?.url || '');
      if (!sourceUrl.startsWith('https://')) throw new Error(payload?.error || 'Globus nevrátil platný zdroj letáku.');
      const sourceResponse = await nativeFetch(sourceUrl, { cache: 'no-store' });
      if (!sourceResponse.ok) throw new Error(`Zdroj Globusu vrátil HTTP ${sourceResponse.status}.`);
      return inspectResponse(sourceResponse);
    }

    return buildLeafletDocument(pageUrls(text));
  }

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (!isLeafletDocumentRequest(url)) return nativeFetch(input, init);

    const cacheKey = url.toString();
    if (generatedDocuments.has(cacheKey)) return responseFromHtml(generatedDocuments.get(cacheKey));

    const response = await nativeFetch(input, init);
    if (!response.ok) return response;

    try {
      const generated = await inspectResponse(response);
      if (!generated) return response;
      generatedDocuments.set(cacheKey, generated);
      return responseFromHtml(generated);
    } catch (error) {
      console.error('Globus leaflet conversion failed', error);
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Leták Globus se nepodařilo připravit.',
      }), {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
  };
})();