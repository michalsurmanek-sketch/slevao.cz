import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync('assets/home-v2.js', 'utf8');
const semantic = fs.readFileSync('assets/home-semantic-filters.js', 'utf8');

assert(
  home.includes("if ($('offerCount')) $('offerCount').textContent = Number(data?.current_count || 0).toLocaleString('cs-CZ');"),
  'home-v2.js must remain the owner of the authoritative homepage offer metric.'
);
assert(
  !semantic.includes("document.getElementById('offerCount')"),
  'Semantic filtering must not overwrite the global homepage offer metric.'
);
assert(
  !semantic.includes('syncHeroOfferCount'),
  'Legacy filtered-result hero metric synchronization must stay removed.'
);
assert(
  semantic.includes("const count = countFromToolbar();"),
  'Semantic panel may still show the filtered result count inside its own UI.'
);

console.log('Homepage hero metrics stability OK');
