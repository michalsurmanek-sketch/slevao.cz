import fs from 'node:fs';

const baseline = JSON.parse(fs.readFileSync('docs/edge-function-security-baseline.json', 'utf8'));
const required = Array.isArray(baseline.jwt_required_debug_functions) ? baseline.jwt_required_debug_functions : [];
const exceptions = Array.isArray(baseline.public_debug_exceptions) ? baseline.public_debug_exceptions : [];

const fail = (message) => {
  console.error(`edge-function-debug-auth: ${message}`);
  process.exit(1);
};

if (!baseline.policy || !String(baseline.policy).includes('debug-*')) fail('missing policy text');
if (exceptions.length !== 1) fail(`expected exactly one public debug exception, got ${exceptions.length}`);
if (exceptions[0]?.slug !== 'debug-kaufland-source') fail('unexpected public debug exception');
if (!String(exceptions[0]?.reason || '').includes('JIP/OCR')) fail('public exception must document the JIP/OCR dependency');
if (required.length < 20) fail(`JWT-required debug baseline unexpectedly small: ${required.length}`);
if (new Set(required).size !== required.length) fail('duplicate JWT-required debug slug');
if (required.some((slug) => !String(slug).startsWith('debug-'))) fail('non-debug function listed in JWT-required debug baseline');
if (required.includes('debug-kaufland-source')) fail('public exception must not also be JWT-required');

for (const slug of ['debug-jip-pack-parser','debug-jip-page-html','debug-terno-parser-v4','debug-terno-ocr-quality','debug-penny-hydration-images','debug-makro-evaluate-prices','debug-makro-price-service','debug-makro-session','debug-makro-legacy-price']) {
  if (!required.includes(slug)) fail(`missing hardened endpoint ${slug}`);
}

console.log(`edge-function-debug-auth: ok (${required.length} JWT-required debug functions, 1 documented exception)`);
