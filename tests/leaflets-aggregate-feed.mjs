import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/leaflets-page.js', root), 'utf8');
new Script(source, { filename:'assets/leaflets-page.js' });

assert.match(source, /rest\/v1\/rpc\/get_public_current_leaflets/, 'Letáky nepoužívají kanonický agregovaný RPC feed.');
assert.match(source, /method:\s*'POST'/, 'Agregovaný feed není volán přes RPC POST.');
assert.match(source, /body:\s*JSON\.stringify\(\{\s*p_limit:\s*240\s*\}\)/, 'Agregovaný feed nemá omezený veřejný payload.');
assert.doesNotMatch(source, /homepage-leaflet-feed/, 'Letáky znovu odkazují na neexistující homepage-leaflet-feed.');
assert.match(source, /const canonicalItems = await fastLeaflets\(\);[\s\S]*if \(canonicalItems\.length\)[\s\S]*return;/, 'N+1 fallback se spouští i po úspěšném agregovaném feedu.');
assert.match(source, /const fallbackItems = await allStoreLeaflets\(\)/, 'Při výpadku agregovaného feedu chybí nouzový fallback.');

console.log('Aggregate leaflet feed OK');
