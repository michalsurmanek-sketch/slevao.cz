import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync('assets/rpc-request-dedupe.js', 'utf8');
const source = fs.readFileSync('assets/home-count-semantics.js', 'utf8');
const home = fs.readFileSync('assets/home-v2.js', 'utf8');

assert(bootstrap.includes("assets/home-count-semantics.js?v=20260822-1"), 'Homepage bootstrap must load the count semantics layer.');
assert(bootstrap.includes("script[data-slevao-count-semantics]"), 'Count semantics layer must be loaded at most once.');
assert(source.includes("label.textContent = 'Platí dnes'"), 'Hero offer count must explicitly mean offers valid today.');
assert(source.includes("dnes + akce začínající do 7 dnů"), 'Result count must explain the upcoming-offer horizon.');
assert(source.includes("mode !== 'ending'"), 'Ending-today mode must not claim to include upcoming offers.');
assert(source.includes("replace(RESULT_SUFFIX, '')"), 'Repeated renders must not duplicate the count scope suffix.');
assert(source.includes('MutationObserver(syncResultScope)'), 'Count scope must stay correct after filter/mode rerenders.');
assert(home.includes('p_include_upcoming:true'), 'Homepage feed must still intentionally include upcoming offers.');
assert(home.includes("Number(data?.current_count || 0)"), 'Hero number must remain sourced from current_count only.');

console.log('Homepage offer count semantics contract OK');
