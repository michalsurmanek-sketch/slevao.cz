import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html')).sort();
assert.ok(
  ['produkt.html', 'seznam.html', 'ucet.html'].every((page) => htmlFiles.includes(page)),
  'Supabase CDN guard must include the core product, shopping-list and account HTML pages.',
);
const failures = [];
const multiClientPages = [];

for (const page of htmlFiles) {
  const html = read(page);
  const localScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi)]
    .map((match) => match[1])
    .map((src) => src.replace(/^\.\//, '').split('?')[0].split('#')[0])
    .filter((src) => src.endsWith('.js') && !/^https?:\/\//i.test(src));

  let clientCreators = (html.match(/(?:window\.)?supabase\.createClient\s*\(/g) || []).length;
  const creatorScripts = [];

  for (const src of localScripts) {
    if (!existsSync(new URL(src, root))) continue;
    const source = read(src);
    if (/(?:window\.)?supabase\.createClient\s*\(/.test(source)) {
      clientCreators += 1;
      creatorScripts.push(src);
    }
  }

  if (clientCreators < 2) continue;
  multiClientPages.push({ page, clientCreators, creatorScripts });

  const hasSingleton = localScripts.includes('assets/supabase-client.js');
  if (!hasSingleton) failures.push({ page, clientCreators, creatorScripts });
}

assert.deepEqual(
  failures,
  [],
  `Stránky s více Supabase klienty bez singleton vrstvy:\n${JSON.stringify(failures, null, 2)}`,
);

const supabaseCdnRefs = [];
const floatingSupabaseCdnRefs = [];
const collectSupabaseCdnRefs = (source, sourcePath) => {
  for (const match of source.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@([^'"\s]+)/g)) {
    const version = match[1].split(/[/?#]/, 1)[0];
    const ref = { source: sourcePath, version, url: match[0] };
    supabaseCdnRefs.push(ref);
    if (!/^\d+\.\d+\.\d+$/.test(version)) floatingSupabaseCdnRefs.push(ref);
  }
};

for (const page of htmlFiles) collectSupabaseCdnRefs(read(page), page);

const assetsDir = new URL('assets/', root);
for (const asset of readdirSync(assetsDir).filter((name) => name.endsWith('.js')).sort()) {
  collectSupabaseCdnRefs(read(`assets/${asset}`), `assets/${asset}`);
}

assert.ok(supabaseCdnRefs.length > 0, 'Expected at least one browser Supabase CDN reference to validate.');
assert.deepEqual(
  floatingSupabaseCdnRefs,
  [],
  `Supabase browser CDN references must use an exact x.y.z version, never @2/latest/floating tags:\n${JSON.stringify(floatingSupabaseCdnRefs, null, 2)}`,
);

const singletonSource = read('assets/supabase-client.js');
new Script(singletonSource, { filename:'assets/supabase-client.js' });

const offlineWindow = {};
new Script(singletonSource, { filename:'supabase-client-offline.js' }).runInContext(createContext({ window:offlineWindow, Object }));
assert.ok(offlineWindow.SlevaoSupabase, 'Supabase singleton facade must install even when the CDN SDK is unavailable.');
assert.equal(
  offlineWindow.SlevaoSupabase.getClient(),
  null,
  'Missing Supabase SDK must degrade to null instead of crashing local-first public pages.',
);

let creates = 0;
const onlineClient = { marker:'singleton' };
const onlineWindow = {
  supabase: {
    createClient() {
      creates += 1;
      return onlineClient;
    }
  }
};
new Script(singletonSource, { filename:'supabase-client-online.js' }).runInContext(createContext({ window:onlineWindow, Object }));
assert.equal(onlineWindow.SlevaoSupabase.getClient(), onlineClient, 'Singleton facade did not create the Supabase client when SDK is available.');
assert.equal(onlineWindow.SlevaoSupabase.getClient(), onlineClient, 'Singleton facade returned a different client on repeated access.');
assert.equal(creates, 1, 'Singleton facade created more than one project client.');

console.log(`Browser Supabase singleton coverage OK (${multiClientPages.length} multi-client pages checked, ${supabaseCdnRefs.length} pinned CDN refs across HTML and JS; offline local-first fallback verified)`);