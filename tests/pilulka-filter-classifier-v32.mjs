import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const v31 = readFileSync(new URL('supabase/migrations/20260829074718_add_product_filter_classifier_v31_pilulka_food_drinks.sql', root), 'utf8');
const v32 = readFileSync(new URL('supabase/migrations/20260829074915_add_product_filter_classifier_v32_pilulka_retail_types.sql', root), 'utf8');

for (const [label, source] of [['v31', v31], ['v32', v32]]) {
  assert.match(source, /v_source_store\s*<>\s*'pilulka'\s+then return 'other'/i,
    `${label}: Pilulka helper must fail closed outside the Pilulka source.`);
  assert.match(source, /lower\(coalesce\(metadata->>'source_store_slug',''\)\)='pilulka'/i,
    `${label}: backfill must be scoped to Pilulka provenance.`);
  assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    `${label}: migration must not hard-code product UUIDs.`);
}

assert.match(v31, /crunchy corn[\s\S]*return 'food'/i,
  'v31 must classify Pilulka Crunchy corn as food.');
assert.match(v31, /detsky caj s echinaceou[\s\S]*return 'drinks'/i,
  'v31 must classify the verified Pilulka child tea as drinks.');

assert.match(v32, /bio losos se zeleninou[\s\S]*return 'food'/i,
  'v32 must classify Pilulka BIO salmon baby food as food.');
assert.match(v32, /probiodrink bitter herbal[\s\S]*return 'drinks'/i,
  'v32 must classify Pilulka Probiodrink as drinks.');
assert.match(v32, /combo spot on pro psy[\s\S]*return 'pets'/i,
  'v32 must classify Pilulka dog spot-on as pets.');
assert.match(v32, /odlicovaci a cistici gel[\s\S]*return 'drugstore'/i,
  'v32 must classify Pilulka cleansing gel as drugstore.');
assert.match(v32, /sandwich francouzke bylinky/i,
  'v32 replay must use the actual normalized Sandwich token sequence.');
assert.doesNotMatch(v32, /sandwich francouzske bylinky/i,
  'v32 replay must not regress to the misspelled normalized Sandwich pattern.');

const autoBodyStart = v32.indexOf('create or replace function public.auto_assign_product_filter_group()');
assert.ok(autoBodyStart >= 0, 'v32 must redefine the auto assignment trigger.');
const autoBody = v32.slice(autoBodyStart);
const v31Call = autoBody.indexOf('infer_product_filter_group_pilulka_v31');
const v32Call = autoBody.indexOf('infer_product_filter_group_pilulka_v32');
const autoCall = autoBody.indexOf('infer_product_filter_group_auto');
assert.ok(v31Call >= 0 && v32Call > v31Call && autoCall > v32Call,
  'Pilulka source-aware helpers must run before the generic auto fallback.');

assert.match(v32,
  /create or replace function public\.product_filter_group_classifier_version\(\)[\s\S]*?select 32/i,
  'Current replay contract must expose classifier version 32.');
assert.match(v32, /classification_source='auto_classifier_v32'/i,
  'v32 backfill must persist explicit classifier provenance.');
assert.match(v32, /classification_confidence=0\.99/i,
  'v32 verified backfill must retain high-confidence provenance.');

console.log('Pilulka filter classifier v31/v32 regression OK');
