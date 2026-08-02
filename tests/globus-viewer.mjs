import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const adapter = read('assets/store-globus-catalog.js');
const page = read('globus.html');

new Script(adapter, { filename: 'assets/store-globus-catalog.js' });

assert.match(adapter, /const nativeFetch = window\.fetch\.bind\(window\)/, 'Globus adaptér se nenačítá před společným feedem.');
assert.match(adapter, /window\.fetch = async/, 'Globus nepřevádí dokument před společným prohlížečem.');
assert.match(adapter, /action-offers\\?\.globus|action-offers\.globus/, 'Globus nepoužívá skutečné strany oficiálního letáku.');
assert.match(adapter, /function buildLeafletDocument\(/, 'Globus neumí sestavit čistý dokument stran letáku.');
assert.match(adapter, /x-slevao-globus-viewer/, 'Globus neoznačuje bezpečně převedený dokument.');
assert.match(adapter, /function looksLikePdf\(bytes\)/, 'Globus nekontroluje skutečnou signaturu PDF.');
assert.match(adapter, /bytes\[0\] === 0x25[\s\S]*bytes\[3\] === 0x46/, 'Globus neověřuje signaturu %PDF.');
assert.doesNotMatch(adapter, /function looksLikePdf\([^)]*contentType/, 'Globus nesmí věřit falešné hlavičce application\/pdf.');
assert.doesNotMatch(adapter, /contentType\.includes\(['"]application\/pdf/, 'Globus nesmí považovat HTML za PDF jen podle Content-Type.');
assert.doesNotMatch(adapter, /MutationObserver|stopImmediatePropagation|openPdfLeaflet|gapi\.globus/, 'Globus znovu obsahuje soupeřící prohlížeč nebo přímý GAPI PDF hack.');
assert.doesNotMatch(adapter, /productCard|Můj Globus|frame\.srcdoc/, 'Globus nesmí vytvářet zvláštní produktový katalog ani ovládat iframe.');

assert.match(page, /<span class="eyebrow">AUTOMATICKÝ LETÁK<\/span>/, 'Globus nemá stejnou hlavičku letáku jako ostatní obchody.');
assert.match(page, /<h2 id="storeLeafletHeading">Aktuální letáky<\/h2>/, 'Globus nemá standardní název sekce letáků.');
assert.match(page, /assets\/store-globus-catalog\.js\?v=20260802-3[\s\S]*assets\/store-feed\.js\?v=20260801-18/, 'Globus převodník se musí načíst před společným store-feed.js.');
assert.match(page, /assets\/store-bottom-nav\.js\?v=20260802-2/, 'Globus nepoužívá společnou spodní navigaci.');

console.log('Globus unified leaflet viewer: OK');