import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260827094509_harden_product_filter_group_classifier_search_path.sql', root), 'utf8');
const source = readFileSync(new URL('supabase/migrations/20260827052624_expand_generic_product_type_classifier_v9.sql', root), 'utf8');

assert.match(
  source,
  /create or replace function public\.product_filter_group_classifier_version\(\)[\s\S]*?as \$\$ select 9; \$\$;/i,
  'Classifier version contract must remain version 9.'
);
assert.match(
  migration,
  /alter function public\.product_filter_group_classifier_version\(\)\s+set search_path\s*=\s*''\s*;/i,
  'Classifier version function must have an explicitly empty search_path.'
);
assert.doesNotMatch(migration, /security\s+(?:definer|invoker)/i, 'Search-path hardening must not change the function security mode.');
assert.doesNotMatch(migration, /\b(?:grant|revoke)\b/i, 'Search-path hardening must not change function execute grants.');
assert.doesNotMatch(migration, /\b(?:drop|create|delete|update|insert)\b/i, 'Search-path hardening migration must not mutate unrelated schema or data.');

console.log('Product filter classifier search_path hardening OK');
await import('./pilulka-filter-classifier-v32.mjs');
