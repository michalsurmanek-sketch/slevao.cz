import fs from 'node:fs';
import path from 'node:path';

const baseline = JSON.parse(fs.readFileSync('docs/edge-function-security-baseline.json', 'utf8'));
const required = Array.isArray(baseline.jwt_required_debug_functions) ? baseline.jwt_required_debug_functions : [];
const publicExceptions = Array.isArray(baseline.public_debug_exceptions) ? baseline.public_debug_exceptions : [];
const customAuth = Array.isArray(baseline.custom_auth_debug_functions) ? baseline.custom_auth_debug_functions : [];

const fail = (message) => {
  console.error(`edge-function-debug-auth: ${message}`);
  process.exit(1);
};

if (!baseline.policy || !String(baseline.policy).includes('debug-*')) fail('missing policy text');
if (publicExceptions.length !== 0) fail(`public debug exceptions are forbidden, got ${publicExceptions.length}`);
if (customAuth.length !== 1) fail(`expected exactly one custom-auth debug exception, got ${customAuth.length}`);
if (customAuth[0]?.slug !== 'debug-kaufland-source') fail('unexpected custom-auth debug function');
if (!String(customAuth[0]?.reason || '').includes('GET and POST both require')) fail('custom-auth exception must document route authorization');
if (required.length < 20) fail(`JWT-required debug baseline unexpectedly small: ${required.length}`);
if (new Set(required).size !== required.length) fail('duplicate JWT-required debug slug');
if (required.some((slug) => !String(slug).startsWith('debug-'))) fail('non-debug function listed in JWT-required debug baseline');
if (required.includes('debug-kaufland-source')) fail('custom-auth function must not also be JWT-required');

for (const slug of ['debug-jip-pack-parser','debug-jip-page-html','debug-terno-parser-v4','debug-terno-ocr-quality','debug-penny-hydration-images','debug-makro-evaluate-prices','debug-makro-price-service','debug-makro-session','debug-makro-legacy-price']) {
  if (!required.includes(slug)) fail(`missing hardened endpoint ${slug}`);
}

const functionsDir = path.join('supabase', 'functions');
const debugDirs = fs.readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('debug-'))
  .map((entry) => entry.name)
  .sort();

const classified = [...new Set([
  ...required,
  ...customAuth.map((entry) => String(entry?.slug || '')).filter(Boolean),
])].sort();
const unclassified = debugDirs.filter((slug) => !classified.includes(slug));
const staleBaseline = classified.filter((slug) => !debugDirs.includes(slug));
if (unclassified.length) fail(`unclassified debug Edge Functions: ${unclassified.join(', ')}`);
if (staleBaseline.length) fail(`security baseline references missing debug Edge Functions: ${staleBaseline.join(', ')}`);

for (const slug of debugDirs) {
  const configPath = path.join(functionsDir, slug, 'config.toml');
  if (!fs.existsSync(configPath)) continue; // Supabase default is verify_jwt=true.
  const config = fs.readFileSync(configPath, 'utf8');
  const disablesJwt = /verify_jwt\s*=\s*false/.test(config);
  if (slug === 'debug-kaufland-source') {
    if (!disablesJwt) fail('debug-kaufland-source custom-auth mode must stay explicitly reproducible as verify_jwt=false');
    continue;
  }
  if (disablesJwt) fail(`unexpected non-JWT debug config: ${slug}`);
}

const proxyPath = path.join(functionsDir, 'debug-kaufland-source', 'index.ts');
const proxy = fs.readFileSync(proxyPath, 'utf8');
for (const needle of [
  "if (req.method === 'GET') {",
  "if (!(await isAuthorized(req))) return response({ error: 'Unauthorized' }, 401);",
  'return proxyJipPage(req);',
  "if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);",
  "const auth = (req.headers.get('authorization') || '').replace(/^Bearer\\s+/i, '').trim();",
  "req.headers.get('x-cron-secret') === CRON_SECRET",
]) {
  if (!proxy.includes(needle)) fail(`debug-kaufland-source missing custom-auth guard: ${needle}`);
}

const getBlock = proxy.match(/if \(req\.method === 'GET'\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
if (!getBlock.includes('isAuthorized(req)') || !getBlock.includes('proxyJipPage(req)')) {
  fail('GET proxy must authorize before proxying');
}
if (/if \(req\.method === 'GET'\) return proxyJipPage\(req\)/.test(proxy)) {
  fail('unauthenticated GET proxy shortcut must not return');
}
if (fs.existsSync('.github/workflows/jip-ocr.yml')) fail('obsolete proxy-dependent JIP workflow must stay removed');
if (fs.existsSync('.github/scripts/jip_ocr_sync.py')) fail('obsolete proxy-dependent JIP client must stay removed');
if (!fs.existsSync('.github/workflows/sync-jip-ocr.yml')) fail('authenticated/direct JIP OCR fallback workflow is missing');
if (!fs.existsSync('scripts/sync_jip_ocr.py')) fail('direct JIP OCR fallback worker is missing');

console.log(`edge-function-debug-auth: ok (${required.length} JWT-required debug functions, 1 custom-auth function, 0 public exceptions)`);
