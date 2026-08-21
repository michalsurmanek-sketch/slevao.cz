import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync('assets/home-v2.js', 'utf8');
const stores = fs.readFileSync('assets/home-all-stores.js', 'utf8');

assert(
  home.includes("if ($('storeCount')) $('storeCount').textContent = state.allStores.length.toLocaleString('cs-CZ');"),
  'home-v2.js must remain the owner of the authoritative displayable-store metric.'
);
assert(
  !stores.includes("$('storeCount').textContent = stores.length"),
  'The all-stores enhancer must not overwrite the hero store metric with every active store.'
);
assert(
  stores.includes('if (document.hidden) return;'),
  'The five-minute store health refresh must pause while the page is hidden.'
);

console.log('Homepage store metric/runtime guard OK');
