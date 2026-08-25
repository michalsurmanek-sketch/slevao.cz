import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const functionsRoot = new URL('supabase/functions/', root);

// These endpoints are intentionally callable by anonymous visitors and expose
// only the published leaflet surface used by the public storefront.
const PUBLIC_READ_ONLY = new Set([
  'store-leaflet-feed',
  'store-leaflet-document',
]);

const failures = [];
const checked = [];

for (const entry of readdirSync(functionsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const slug = entry.name;
  const configUrl = new URL(`${slug}/config.toml`, functionsRoot);
  const sourceUrl = new URL(`${slug}/index.ts`, functionsRoot);
  if (!existsSync(configUrl) || !existsSync(sourceUrl)) continue;

  const config = readFileSync(configUrl, 'utf8');
  if (!/verify_jwt\s*=\s*false/.test(config)) continue;

  const source = readFileSync(sourceUrl, 'utf8');
  checked.push(slug);

  if (PUBLIC_READ_ONLY.has(slug)) continue;

  const readsAuthorization = /headers\.get\(['"]authorization['"]\)/i.test(source);
  const serviceRoleGuard = /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE(?:_KEY)?/i.test(source)
    && readsAuthorization;
  const cronGuard = /CRON_SECRET/.test(source)
    && /x-cron-secret/i.test(source);
  const userGuard = /\.auth\.getUser\s*\(/.test(source)
    && readsAuthorization;
  const rejectsUnauthorized = /Unauthorized|Nedostatečné oprávnění|Přihlášení vypršelo|Neautorizováno/i.test(source);

  if (!(rejectsUnauthorized && (serviceRoleGuard || cronGuard || userGuard))) {
    failures.push({
      slug,
      serviceRoleGuard,
      cronGuard,
      userGuard,
      rejectsUnauthorized,
    });
  }
}

assert(checked.length > 0, 'Nebyla nalezena žádná funkce s verify_jwt=false; kontrola se pravděpodobně nespustila nad správným stromem.');
assert.deepEqual(
  failures,
  [],
  `Edge Functions s verify_jwt=false bez prokazatelného custom-auth guardu:\n${JSON.stringify(failures, null, 2)}`,
);

console.log(`Edge custom-auth coverage OK (${checked.length} functions checked)`);
