import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/sync-jip-pack-products/index.ts', 'utf8');

assert(edge.includes("const SOURCE_ADAPTER = 'jip-flip-pdf-v1';"), 'JIP pack sync must stay attached to the verified flip source adapter.');
assert(edge.includes('const SOURCE_PAGE_COUNT = 12;'), 'JIP pack parser must only consume the verified 12-page Maloobchod layout.');
assert(edge.includes(".lte('detected_valid_from', d)"), 'JIP pack source must already be active on the Czech business date.');
assert(edge.includes(".gte('detected_valid_to', d)"), 'JIP pack source must still be valid on the Czech business date, including its final day.');
assert(!edge.includes(".gt('detected_valid_to',d)"), 'JIP pack sync must not exclude a leaflet on its final valid day.');
assert(edge.includes("images.length === SOURCE_PAGE_COUNT"), 'JIP pack source must provide the complete 12-page image set.');
assert(edge.includes('/\\/MO-\\d{1,2}-\\d{1,2}-\\d{4}\\/$/i'), 'JIP pack source must be the official MO-* Maloobchod document, not a 24-page CC leaflet.');
assert(edge.includes('waiting_source: true'), 'Missing current MO source must be a non-error waiting-source result.');
assert(edge.includes('No current 12-page JIP Maloobchod source with complete page images'), 'Waiting-source reason must explain the source contract.');
assert(edge.includes('candidates.length < 8 || candidates.length > 30'), 'JIP candidate-count safety guard must remain fail-closed.');
assert(edge.includes("Number(c.conf?.price || 0) < 90"), 'JIP price OCR confidence floor must remain intact.');
assert(edge.includes("Number(c.conf?.title || 0) < 82"), 'JIP title OCR confidence floor must remain intact.');
assert(edge.includes("Number(c.conf?.qty || 0) < 75"), 'JIP quantity OCR confidence floor must remain intact.');
assert(edge.includes("if (existing?.status === 'published')"), 'JIP live reruns must reuse an already published source import instead of duplicating offers.');

console.log('JIP pack source contract OK');
