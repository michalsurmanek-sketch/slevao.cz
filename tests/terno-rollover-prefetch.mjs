import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260825182500_terno_rollover_prefetch.sql', root), 'utf8');
const source = readFileSync(new URL('supabase/functions/sync-terno-source/index.ts', root), 'utf8');
const workflow = readFileSync(new URL('.github/workflows/sync-terno-ocr.yml', root), 'utf8');

assert.match(source, /timeZone:\s*'Europe\/Prague'/, 'Terno source must use Prague dates.');
assert.match(source, /flyer\.validFrom <= tomorrow && flyer\.validTo >= today/, 'Terno source must discover tomorrow while keeping today.');
assert.match(sql, /'page_image_urls',\s*v_pages/, 'Terno OCR target must return page image URLs.');
assert.match(sql, /li\.detected_valid_from <= v_tomorrow/, 'Terno OCR target must include tomorrow.');
assert.match(sql, /trg_preserve_terno_official_validity/, 'Official Terno validity must be protected from null fallback updates.');
assert.match(workflow, /\.github\/terno-ocr-trigger\.txt/, 'Terno OCR must support an explicit safe trigger.');

console.log('Terno rollover prefetch OK');
