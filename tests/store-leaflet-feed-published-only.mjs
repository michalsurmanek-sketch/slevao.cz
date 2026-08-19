import fs from 'node:fs';

const path = 'supabase/functions/store-leaflet-feed/index.ts';
if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
const source = fs.readFileSync(path, 'utf8');

for (const needle of [
  "db.rpc('get_public_current_leaflets', { p_limit: 500 })",
  ".eq('is_active', true)",
  "source: 'canonical'",
  "source: leaflets.length ? 'official-fallback' : 'none'",
  'const OFFICIAL_FALLBACKS',
  'function safeOfficialUrl(value: unknown)',
  "if (url.protocol !== 'https:' || url.username || url.password) return ''",
  "if (host === 'slevao.cz' || host.endsWith('.slevao.cz') || isPrivateOrLocalHost(host)) return ''",
  "url.hash = ''",
]) {
  if (!source.includes(needle)) throw new Error(`Missing canonical leaflet-feed guard: ${needle}`);
}

for (const forbidden of [
  /\.from\(['"]leaflet_imports['"]\)/i,
  /['"]review['"]/i,
  /['"]publishing['"]/i,
  /fetch\s*\(/i,
  /SERVICE_ROLE_KEY[^\n]*console/i,
  /source:\s*['"]database-fallback['"]/i,
]) {
  if (forbidden.test(source)) throw new Error(`Unsafe legacy leaflet-feed behavior remains: ${forbidden}`);
}

const rpcPos = source.indexOf("db.rpc('get_public_current_leaflets'");
const fallbackPos = source.indexOf('officialFallback(store)');
if (rpcPos < 0 || fallbackPos < 0 || rpcPos > fallbackPos) {
  throw new Error('Canonical published RPC must be attempted before official fallback.');
}

for (const slug of ['action','tesco','obi','globus','makro','planeo']) {
  if (!new RegExp(`['\"]${slug.replace('-', '\\-')}['\"]?\\s*:`).test(source) && !source.includes(`${slug}:`)) {
    throw new Error(`Missing safe official fallback for ${slug}.`);
  }
}

console.log('store-leaflet-feed: canonical published boundary OK');
