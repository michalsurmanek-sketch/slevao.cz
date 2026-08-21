import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/home-overview-leaflets-fix.js', 'utf8');

const watchStart = source.indexOf('function watchEndingSection()');
assert(watchStart >= 0, 'Overview ending section watcher must exist.');
const watchBody = source.slice(watchStart, source.indexOf("window.addEventListener('pagehide'", watchStart));

assert(!/\n\s*loadProductLinks\(\);\s*\n/.test(watchBody), 'Product link mapping must not load eagerly when the overview initializes.');
assert(source.includes("target.addEventListener('pointerenter', prefetchProductLinks"), 'Pointer hover should prefetch product links before click.');
assert(source.includes("target.addEventListener('pointerdown', prefetchProductLinks"), 'Touch/pointer interaction should prefetch product links before click.');
assert(source.includes("target.addEventListener('focusin', prefetchProductLinks"), 'Keyboard focus should prefetch product links before activation.');
assert(source.includes("target.addEventListener('click', followProductLink)"), 'A plain click must wait for the lazy mapping and preserve product-detail navigation.');
assert(source.includes("await loadProductLinks();"), 'Click fallback must await the lazy product-link request.');
assert(source.includes("window.location.assign(target);"), 'Click fallback must continue navigation after lazy resolution.');

console.log('Homepage overview product links lazy loading OK');
