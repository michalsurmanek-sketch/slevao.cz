import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const requiredFiles = [
  'index.html', 'admin.html', 'admin-automatizace.html', 'robots.txt',
  'sitemap.xml', 'favicon.svg', 'assets/search-suggest.css',
  'assets/search-suggest.js',
];

for (const path of requiredFiles) {
  assert(existsSync(new URL(`../${path}`, import.meta.url)), `Chybí povinný soubor: ${path}`);
}

const index = read('index.html');
assert.match(index, /<link rel="canonical" href="https:\/\/slevao\.cz\/">/, 'Homepage nemá canonical URL.');
assert.match(index, /application\/ld\+json/, 'Homepage nemá strukturovaná data.');
assert.match(index, /<meta property="og:title"/, 'Homepage nemá Open Graph metadata.');
assert.match(index, /fetchActiveOffers/, 'Katalog musí podporovat stránkované načítání z databáze.');
assert.match(index, /deduplicateOffers/, 'Katalog musí mít ochranu proti duplicitám.');

const inlineScripts = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert(inlineScripts.length > 0, 'Homepage neobsahuje aplikační JavaScript.');
for (const source of inlineScripts) new Script(source, { filename: 'index.html:inline-script' });
new Script(read('assets/search-suggest.js'), { filename: 'assets/search-suggest.js' });

const redirects = {
  'login.html': 'admin.html',
  'moderation.html': 'admin.html',
  'account.html': './',
  'collections.html': './',
  'detail.html': './',
  'reels.html': './',
  'submit.html': './',
  'index2.html': './',
};
for (const [path, target] of Object.entries(redirects)) {
  const html = read(path);
  assert.match(html, /noindex/, `${path} musí být vyřazen z indexace.`);
  assert(html.includes(`url=${target}`), `${path} nemíří na ${target}.`);
}

const functionPaths = [
  'supabase/functions/discover-leaflets/index.ts',
  'supabase/functions/process-leaflet/index.ts',
  'supabase/functions/publish-imports/index.ts',
  'supabase/functions/run-leaflet-import/index.ts',
];
const functionSources = functionPaths.map(read).join('\n');
assert(!/user_metadata\?\.role/.test(functionSources), 'Oprávnění nesmí vycházet z user_metadata.');
assert.match(read(functionPaths[0]), /if \(!CRON_SECRET\)/, 'Discovery musí selhat při chybějícím CRON_SECRET.');

const publicSources = [
  'login.html', 'moderation.html', 'account.html', 'collections.html',
  'detail.html', 'reels.html', 'submit.html', 'index2.html',
].map(read).join('\n');
assert(!/ADMIN_PIN|cdn\.tailwindcss\.com|zatím lokálně/.test(publicSources), 'Na web se vrátil vývojový prototyp.');

const robots = read('robots.txt');
assert.match(robots, /Sitemap: https:\/\/slevao\.cz\/sitemap\.xml/, 'robots.txt neodkazuje na sitemapu.');
assert.match(read('sitemap.xml'), /<loc>https:\/\/slevao\.cz\/<\/loc>/, 'Sitemap neobsahuje homepage.');

console.log('Slevao.cz quality checks: OK');
