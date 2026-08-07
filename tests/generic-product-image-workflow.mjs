import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260807171000_generic_product_image_generation.sql');
const generator = read('supabase/functions/generate-generic-product-images/index.ts');
const config = read('supabase/functions/generate-generic-product-images/config.toml');
const admin = read('admin-generovani-fotografii.html');

for (const text of ['product_image_generation_runs','product_image_generation_jobs','missing_image','queued_for_generation','generating','generated','assigned','needs_manual_review','skipped_branded']) assert(migration.includes(text), `Migrace postrádá ${text}.`);
assert.match(migration,/enable row level security/i,'Generovací tabulky nemají RLS.');
assert.match(migration,/generation_workflow[^\n]+unbranded_v1/,'Automatické schválení není omezené na neznačkový workflow.');
assert.match(migration,/quality_score[^\n]+80/,'Automatické schválení nemá minimální kvalitu 80.');
assert.match(migration,/match_score[^\n]+0\.90/,'Automatické schválení nemá minimální jistotu 0.90.');
assert.doesNotMatch(migration,/delete\s+from\s+public\.(products|offers|leaflet_import_items)/i,'Migrace nesmí mazat produkty ani nabídky.');

for (const pattern of [/String\(product\.brand \|\| ''\)\.trim\(\)/,/BRAND_GUARD/,/specific_packaged/,/gpt-image-2/,/output_format:'webp'/,/clean_white_background/,/no_logo_or_brand/,/no_watermark/,/packaging_is_appropriate/,/product_image_candidates/,/product_image_library/,/WORKER_SIZE = 2/,/attempt<2/]) assert.match(generator,pattern,`Generátor postrádá ochranu ${pattern}.`);
assert.doesNotMatch(generator,/const\s+CRON_SECRET\s*=\s*['"][^'"]+['"]/,'CRON secret nesmí být natvrdo v kódu.');
assert.doesNotMatch(generator,/SUPABASE_SERVICE_ROLE_KEY[^\n]+['"][A-Za-z0-9._-]{30,}['"]/,'Service role key nesmí být natvrdo v kódu.');
assert.match(config,/verify_jwt\s*=\s*false/,'Funkce s vlastní autorizací musí umožnit CRON secret.');

for (const id of ['sMissing','sQueued','sGenerating','sAssigned','sManual','sBranded','batchSize','generate','recent']) assert(admin.includes(`id="${id}"`),`Admin přehled postrádá ${id}.`);
assert.match(admin,/<option value="20">20 produktů<\/option>/,'Admin nemá dávku 20.');
assert.match(admin,/<option value="50">50 produktů<\/option>/,'Admin nemá dávku 50.');
assert.match(admin,/generate-generic-product-images/,'Admin nespouští generovací Edge Function.');
const scripts=[...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match)=>match[1]);
assert(scripts.length>0,'Admin stránka neobsahuje aplikační JavaScript.');
for(const source of scripts)new Script(source,{filename:'admin-generovani-fotografii.html:inline-script'});
console.log('Generic product image workflow: OK');
