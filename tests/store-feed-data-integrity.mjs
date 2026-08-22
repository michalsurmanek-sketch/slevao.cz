import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/store-feed.js', import.meta.url), 'utf8');

assert.match(source, /const requestAll = async \(table, params, pageSize = 500\)/, 'Store feed musí stránkovat větší výsledky.');
assert.ok(source.includes('limit: String(pageSize)'), 'Stránkování musí posílat explicitní limit.');
assert.ok(source.includes('offset: String(offset)'), 'Stránkování musí posílat explicitní offset.');
assert.ok(source.includes("const rows = await requestAll('offers', {"), 'Nabídky se musí načítat přes stránkovaný requestAll.');
assert.ok(source.includes("is_active: 'eq.true'"), 'Store feed musí odmítnout neaktivní obchod.');
assert.ok(source.includes("order: 'published_at.desc,id.asc'"), 'Stránkování musí mít deterministické řazení published_at + id.');
assert.ok(source.includes("if (batch.length < pageSize) return rows;"), 'Stránkování musí skončit po poslední neúplné dávce.');
assert.ok(source.includes("throw new Error('Počet nabídek překročil bezpečný limit stránkování.')"), 'Stránkování musí mít bezpečnostní horní mez.');

const uniqueStart = source.indexOf('const unique = (rows) =>');
const uniqueEnd = source.indexOf('\n\n  function searchableText', uniqueStart);
assert.ok(uniqueStart >= 0 && uniqueEnd > uniqueStart, 'Store feed musí mít kontrolovanou deduplikaci.');
const uniqueSource = source.slice(uniqueStart, uniqueEnd);
assert.ok(uniqueSource.includes("const id = String(offer?.id || '')"), 'Deduplikace smí identifikovat nabídku pouze podle offer.id.');
assert.ok(uniqueSource.includes('seen.has(id)'), 'Deduplikace musí odstranit jen opakovaný stejný offer.id.');
assert.ok(uniqueSource.includes('seen.add(id)'), 'Deduplikace musí evidovat již zobrazené offer.id.');
assert.doesNotMatch(uniqueSource, /fold\(offer\.title\)|valid_from|valid_to|product_id|price/, 'Deduplikace nesmí slučovat různé nabídky podle názvu, platnosti, produktu ani ceny.');

console.log('OK: store-feed stránkuje nabídky, používá stabilní pořadí, respektuje stores.is_active a deduplikuje jen stejné offer.id.');
