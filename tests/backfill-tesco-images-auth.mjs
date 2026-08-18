import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const fn = read('supabase/functions/backfill-tesco-images/index.ts');
const config = read('supabase/functions/backfill-tesco-images/config.toml');

assert.match(config, /^verify_jwt\s*=\s*true\s*$/m, 'Tesco image backfill musí vyžadovat platform JWT.');
assert.match(fn, /service\s*=\s*auth === `Bearer \$\{SERVICE_ROLE_KEY\}`/, 'Backfill neověřuje service-role volání.');
assert.match(fn, /userAllowed[\s\S]*\['admin', 'editor'\]/, 'Backfill neomezuje uživatelský přístup na admin/editor.');
assert.match(fn, /if \(!service && !trustedCron && !userAllowed\)/, 'Backfill nemá vlastní fail-closed autorizaci.');
assert.match(fn, /product_image_candidates/, 'Backfill musí dál zapisovat jen kandidáty obrázků ke kontrole.');

console.log('Tesco image backfill auth OK');
