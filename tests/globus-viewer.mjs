import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const documentProxy = read('supabase/functions/store-leaflet-document/index.ts');
const sharedViewer = read('assets/store-feed.js');
const page = read('globus.html');

assert.match(documentProxy, /function globusPdfFromHtml\(/, 'Dokumentový proxy neumí z HTML Globusu vybrat skutečné PDF.');
assert.match(documentProxy, /gapi\.globus\.cz/, 'Dokumentový proxy nepovoluje oficiální Globus GAPI dokument.');
assert.match(documentProxy, /url\.pathname === '\/OnlineAsset\/3\/asset'/, 'Globus GAPI URL není dostatečně omezená.');
assert.match(documentProxy, /!url\.searchParams\.has\('type'\)/, 'Globus nerozlišuje PDF od produktových obrázků.');
assert.match(documentProxy, /storeSlug === 'globus'/, 'Staré Globus importy nejsou zpracované zvláštní bezpečnou cestou.');
assert.match(documentProxy, /function blobMagic\(blob: Blob\)/, 'Chybí načtení skutečných prvních bajtů uloženého dokumentu.');
assert.match(documentProxy, /blob\.slice\(0, 8\)\.arrayBuffer\(\)/, 'Uložený Globus dokument se nekontroluje podle skutečných bajtů.');
assert.match(documentProxy, /blobMagic\(storedDocument\)/, 'Kontrola bajtů se nepoužívá na uložený Globus dokument.');
assert.match(documentProxy, /bytes\[0\] === 0x25[\s\S]*bytes\[3\] === 0x46/, 'Globus PDF se neověřuje podle signatury %PDF.');
assert.match(documentProxy, /resolveGlobusPdf\(sourceDocumentUrl\)/, 'Starý HTML import Globusu se nepřekládá na aktuální PDF.');
assert.match(documentProxy, /content-disposition[^\n]*globus-letak\.pdf/, 'Globus PDF se neposílá jako dokument pro zobrazení uvnitř stránky.');
assert.doesNotMatch(documentProxy, /return 'application\/pdf';\s*\n}\s*\nfunction inlineFilename/, 'Neznámý soubor nesmí být automaticky vydáván za PDF.');

assert.match(sharedViewer, /async function openLeafletViewer\(/, 'Globus nemůže používat společný prohlížeč letáků.');
assert.match(sharedViewer, /URL\.createObjectURL\(documentBlob\)/, 'Společný prohlížeč neumí bezpečně zobrazit proxované PDF.');
assert.match(page, /assets\/store-feed\.js\?v=20260802-20/, 'Globus nenačítá aktuální společný prohlížeč.');
assert.match(page, /assets\/store-bottom-nav\.js\?v=20260802-2/, 'Globus nepoužívá společnou spodní navigaci.');
assert.doesNotMatch(page, /store-globus-catalog\.js/, 'Globus stále načítá starý klientský převodník.');
assert.match(page, /<h2 id="storeLeafletHeading">Aktuální letáky<\/h2>/, 'Globus nemá stejnou sekci letáku jako ostatní obchody.');

const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 45_000);
try {
  const feedResponse = await fetch(`${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=globus&source=official-v6`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
    signal: controller.signal,
  });
  assert.equal(feedResponse.ok, true, `Živý Globus feed vrátil HTTP ${feedResponse.status}.`);
  const feed = await feedResponse.json();
  assert.ok(Array.isArray(feed.leaflets) && feed.leaflets.length > 0, 'Živý Globus feed nemá aktuální leták.');
  const previewUrl = String(feed.leaflets[0]?.preview_url || '');
  assert.ok(previewUrl.startsWith(`${SUPABASE_URL}/functions/v1/store-leaflet-document?`), 'Živý Globus feed nevrací interní preview URL.');

  const documentResponse = await fetch(previewUrl, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
    signal: controller.signal,
  });
  assert.equal(documentResponse.ok, true, `Živý Globus dokument vrátil HTTP ${documentResponse.status}: ${(await documentResponse.clone().text()).slice(0, 240)}`);
  assert.match(String(documentResponse.headers.get('content-type') || ''), /application\/pdf/i, 'Živý Globus dokument nemá typ application/pdf.');
  assert.ok(documentResponse.body, 'Živý Globus dokument nemá tělo.');
  const reader = documentResponse.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  assert.ok(first.value && first.value.length >= 4, 'Živý Globus PDF je prázdný.');
  assert.deepEqual([...first.value.slice(0, 4)], [0x25, 0x50, 0x44, 0x46], 'Živý Globus dokument nezačíná signaturou %PDF.');
} finally {
  clearTimeout(timeout);
}

console.log('Globus server-side PDF viewer and live endpoint: OK');