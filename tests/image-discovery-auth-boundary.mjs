import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const baseConfig = read('supabase/functions/discover-product-images/config.toml');
const webConfig = read('supabase/functions/discover-product-images-web/config.toml');
const smartConfig = read('supabase/functions/discover-product-images-smart/config.toml');
const smart = read('supabase/functions/discover-product-images-smart/index.ts');
const base = read('supabase/functions/discover-product-images/index.ts');
const web = read('supabase/functions/discover-product-images-web/index.ts');

assert.match(baseConfig, /^verify_jwt\s*=\s*true\s*$/m, 'discover-product-images must require gateway JWT.');
assert.match(webConfig, /^verify_jwt\s*=\s*true\s*$/m, 'discover-product-images-web must require gateway JWT.');
assert.match(smartConfig, /^verify_jwt\s*=\s*false\s*$/m, 'smart orchestrator must keep explicit custom-auth boundary until legacy cron auth is removed.');

assert.match(smart, /authorization:\s*`Bearer \$\{KEY\}`/, 'smart orchestrator must call child discovery functions with service-role Bearer JWT.');
assert.match(smart, /call\('discover-product-images'/, 'smart orchestrator must call base discovery endpoint.');
assert.match(smart, /call\('discover-product-images-web'/, 'smart orchestrator must call web discovery endpoint.');
assert.match(smart, /LEGACY_CRON_SHA256/, 'smart custom-auth exception must remain tied to explicit legacy cron compatibility.');

for (const [name, source] of [['base', base], ['web', web]]) {
  assert.match(source, /token === serviceKey/, `${name} discovery must accept service-role Bearer token.`);
  assert.match(source, /\['admin', 'editor'\]|\["admin", "editor"\]/, `${name} discovery must retain admin/editor authorization.`);
  assert.match(source, /function errorMessage\(error: unknown\): string/, `${name} discovery must centralize safe error serialization.`);
  assert.match(source, /row\.details/, `${name} discovery must preserve PostgREST error details.`);
  assert.match(source, /row\.hint/, `${name} discovery must preserve PostgREST error hint.`);
  assert.match(source, /code=\$\{row\.code\.trim\(\)\}/, `${name} discovery must preserve PostgREST error code.`);
  assert.match(source, /const message = errorMessage\(error\)/, `${name} top-level errors must use safe serialization.`);
  assert.doesNotMatch(source, /const message = error instanceof Error \? error\.message : String\(error\)/, `${name} discovery must not collapse object errors to [object Object].`);
}

assert.match(base, /validationError = errorMessage\(error\)/, 'per-product validation errors must use safe serialization.');
assert.match(base, /data: imports, error: importsError/, 'leaflet import lookup must capture database errors.');
assert.match(base, /if \(importsError\) throw importsError;/, 'leaflet import lookup must fail closed on database errors.');
assert.match(base, /data: offers, error: offersError/, 'stored offer lookup must capture database errors.');
assert.match(base, /if \(offersError\) throw offersError;/, 'stored offer lookup must fail closed on database errors.');
assert.match(base, /async function blockedUrls[\s\S]*?const \{ data, error \} = await db\.from\("product_image_candidates"\)[\s\S]*?if \(error\) throw error;/, 'blocked image lookup must fail closed on database errors.');
assert.match(base, /if \(!validationError\) \{[\s\S]*?error: checkedError[\s\S]*?if \(checkedError\) throw checkedError;/, 'image_checked_at must only be written after a completed validation and database errors must surface.');

assert.match(web, /async function blockedUrls[\s\S]*?const \{ data, error \} = await db\.from\("product_image_candidates"\)[\s\S]*?if \(error\) throw error;/, 'web blocked image lookup must fail closed on database errors.');
assert.match(web, /errors\.push\(errorMessage\(error\)\)/, 'web per-candidate validation errors must preserve structured error details.');
assert.match(web, /if \(!errors\.length\) \{[\s\S]*?error: checkedError[\s\S]*?if \(checkedError\) throw checkedError;/, 'web image_checked_at must only be written after an error-free validation pass and update errors must surface.');
assert.doesNotMatch(web, /errors\.push\(error instanceof Error \? error\.message : String\(error\)\)/, 'web discovery must not collapse candidate object errors to [object Object].');

console.log('Image discovery auth and error boundary OK');
