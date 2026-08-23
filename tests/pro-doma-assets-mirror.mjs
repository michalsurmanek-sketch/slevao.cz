import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260823120416_switch_pro_doma_index_to_official_assets_mirror.sql', 'utf8');

assert(migration.includes("https://r.jina.ai/https://assets.pro-doma.cz/akce"), 'PRO-DOMA index fetch must use the working official assets mirror.');
assert(migration.includes("'source_url','https://www.pro-doma.cz/akce'"), 'PRO-DOMA public source URL must remain canonical.');
assert(migration.includes("'fetch_url','https://assets.pro-doma.cz/akce'"), 'PRO-DOMA technical mirror must be observable in job metadata.');
assert(migration.includes("https://(?:www|assets)[.]pro-doma[.]cz/[^ )]+"), 'PRO-DOMA event discovery must accept both official hostnames.');
assert(migration.includes("'^https://assets[.]pro-doma[.]cz/'"), 'PRO-DOMA discovered assets URLs must be canonicalized.');
assert(migration.includes("'https://www.pro-doma.cz/'"), 'PRO-DOMA event details must continue through canonical www URLs.');
assert(migration.includes("health_status='running'"), 'PRO-DOMA trigger must expose active sync state.');
assert(migration.includes("health_status='error'"), 'PRO-DOMA terminal index failures must still fail closed.');
assert(migration.includes("set search_path to 'public', 'net', 'pg_temp'"), 'PRO-DOMA SECURITY DEFINER functions must keep a fixed search_path.');

console.log('PRO-DOMA official assets mirror contract OK');
