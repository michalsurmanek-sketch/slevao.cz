import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/sync-flop-pdf-products/index.ts', 'utf8');

assert(source.includes("parser:'flop-pdf-spatial-unit-price-v4'"), 'Flop parser version v4 is missing');
assert(source.includes("payload_contract:'flop-pdf-spatial-safe-v4'"), 'Flop payload contract v4 is missing');
assert(source.includes("parser_contract:'flop-pdf-spatial-unit-price-v4'"), 'Flop parser payload contract must match v4');
assert(source.includes("verification:'printed_unit_price_math'"), 'Flop offers must be mathematically verified against printed unit price');
assert(source.includes('if (delta <= 0.06)'), 'Flop printed-price tolerance must stay bounded');
assert(source.includes('if (localPromo(tokens, q, printed.y)) continue;'), 'Conditional/local promo offers must be rejected');
assert(source.includes('Math.abs(t.x - quantity.x) <= 45'), 'Title candidates must stay close to the quantity anchor');
assert(source.includes('Math.abs(t.x - seed.x) <= 28'), 'Title lines must stay in one spatial stack');
assert(source.includes("if (/\\/Flop_A_/i.test(row.source_document_url || '')) continue;"), 'Flop_A leaflet variant must not feed FLOP TOP products');
assert(source.includes('if (body.dry_run !== false)'), 'Flop parser must default to dry-run');
assert(source.includes('if (candidates.length < 25)'), 'Production publish must fail closed on low candidate count');
assert(source.includes(".lt('valid_to',validity.from);"), 'Old FLOP TOP offers must expire only before the new validity window');
assert(!source.includes('source_url.neq.'), 'Flop publication must not broadly expire offers by URL inequality');
assert(source.includes("status:'approved'"), 'Only approved deterministic candidates should enter publish-imports');
assert(source.includes('confidence:0.99'), 'Deterministic candidates must retain high confidence');

console.log('Flop spatial PDF parser v4 contract OK');
