import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const adapter = read('assets/store-globus-catalog.js');
const page = read('globus.html');

new Script(adapter, { filename: 'assets/store-globus-catalog.js' });

assert.match(adapter, /function extractPdfUrl\(/, 'Globus nemá výběr oficiálního PDF.');
assert.match(adapter, /gapi\\?\.globus|gapi\.globus/, 'Globus nepoužívá oficiální GAPI dokument.');
assert.match(adapter, /application\/pdf/, 'Globus neověřuje PDF dokument.');
assert.match(adapter, /data-leaflet-preview/, 'Globus nepoužívá stejnou kartu letáku jako ostatní obchody.');
assert.match(adapter, /leaflet-viewer-open/, 'Globus nepoužívá společný mobilní celoobrazovkový prohlížeč.');
assert.doesNotMatch(adapter, /frame\.srcdoc\s*=/, 'Globus nesmí zobrazovat vlastní HTML katalog místo PDF.');
assert.doesNotMatch(adapter, /function productCard|class=\\?"product/, 'Globus nesmí vytvářet zvláštní produktový katalog.');

assert.match(page, /<span class="eyebrow">AUTOMATICKÝ LETÁK<\/span>/, 'Globus nemá stejnou hlavičku letáku jako ostatní obchody.');
assert.match(page, /<h2 id="storeLeafletHeading">Aktuální letáky<\/h2>/, 'Globus nemá standardní název sekce letáků.');
assert.match(page, /assets\/store-globus-catalog\.js\?v=20260802-2/, 'Globus nenačítá opravený PDF adaptér.');

console.log('Globus PDF viewer: OK');
