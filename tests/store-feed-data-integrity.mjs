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

console.log('OK: store-feed stránkuje nabídky, používá stabilní pořadí a respektuje stores.is_active.');
