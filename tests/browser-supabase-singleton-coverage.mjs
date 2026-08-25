import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html')).sort();
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

console.log(`Browser Supabase singleton coverage OK (${multiClientPages.length} multi-client pages checked)`);
