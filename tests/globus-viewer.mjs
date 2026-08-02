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
assert.match(documentProxy, /storedDocument\.slice\(0, 8\)/, 'Uložený Globus dokument se nekontroluje podle skutečných bajtů.');
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

console.log('Globus server-side PDF viewer: OK');