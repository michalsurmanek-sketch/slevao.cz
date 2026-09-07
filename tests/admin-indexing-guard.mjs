import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const robots = readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
const disallowRules = robots
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^Disallow:/i.test(line))
  .map((line) => line.replace(/^Disallow:\s*/i, '').trim())
  .filter(Boolean);

const adminPages = readdirSync(root)
  .filter((name) => name === 'admin.html' || /^admin-.*\.html$/i.test(name))
  .sort();

assert.ok(adminPages.length > 0, 'Nebyly nalezeny žádné admin HTML stránky.');
assert.ok(
  disallowRules.includes('/admin'),
  'robots.txt musí obsahovat prefixovou blokaci Disallow: /admin pro všechny interní admin stránky.',
);

for (const page of adminPages) {
  const pathname = `/${page}`;
  assert.ok(
    disallowRules.some((rule) => pathname.startsWith(rule)),
    `${pathname} není pokrytý žádným Disallow pravidlem v robots.txt.`,
  );
}

assert.ok(
  !disallowRules.some((rule) => '/index.html'.startsWith(rule)),
  'Veřejná homepage nesmí být blokovaná v robots.txt.',
);
assert.match(robots, /Sitemap:\s*https:\/\/slevao\.cz\/sitemap\.xml/i);
assert.match(robots, /Sitemap:\s*https:\/\/slevao\.cz\/sitemap-products\.xml/i);

console.log(`Admin indexing guard: ${adminPages.length} interních admin stránek je blokováno před crawlingem.`);
