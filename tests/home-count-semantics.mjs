import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync('assets/rpc-request-dedupe.js', 'utf8');
const source = fs.readFileSync('assets/home-count-semantics.js', 'utf8');
const home = fs.readFileSync('assets/home-v2.js', 'utf8');

assert(bootstrap.includes("assets/home-count-semantics.js?v=20260901-1"), 'Homepage bootstrap must load the current count semantics layer.');
assert(source.includes("storeLabel.textContent = 'Obchodů s nabídkou'"), 'Store metric must say it counts only stores with a current offer.');
assert(bootstrap.includes("script[data-slevao-count-semantics]"), 'Count semantics layer must be loaded at most once.');
assert(source.includes("label.textContent = 'Platí dnes'"), 'Hero offer count must explicitly mean offers valid today.');
assert(source.includes('všech veřejně vyhledatelných nabídek'), 'Hero tooltip must explain that the total is searchable public inventory.');
assert(source.includes("mode === 'recommended'"), 'Recommended mode must have explicit subset semantics.');
assert(source.includes("doporučených nabídek"), 'Recommended result count must say it is a recommended subset.');
assert(source.includes("výběr z "), 'Recommended result count must reference the all-offers total.');
assert(source.includes("mode !== 'ending'"), 'Ending-today mode must not claim to include upcoming offers.');
assert(source.includes('cleanResultText'), 'Repeated renders must normalize previously appended count explanations.');
assert(source.includes('MutationObserver(syncResultScope)'), 'Count scope must stay correct after filter/mode rerenders.');
assert(source.includes("document.getElementById('offerCount')"), 'Recommended subset explanation must be tied to the current searchable total.');
assert(home.includes('p_include_upcoming:true'), 'Homepage feed must still intentionally include upcoming offers.');
assert(home.includes("Number(data?.current_count || 0)"), 'Hero number must remain sourced from current_count only.');

console.log('Homepage offer count semantics contract OK');
