import fs from 'node:fs';

const path = 'supabase/functions/sync-kaufland-source/index.ts';
if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
const source = fs.readFileSync(path, 'utf8');

for (const needle of [
  "const liveCount = Number(currentOfferCount || 0)",
  "const sourceMinimum = Math.max(50, Math.floor(products.length * 0.9))",
  "liveCount >= sourceMinimum",
  "if (liveCount >= 50 && products.length < Math.floor(liveCount * 0.6))",
  "live_offer_count: liveCount",
  "historical_offer_count: previousCount",
  "http_status: response.status",
  "html_length: html.length",
  "product_candidates: products.length",
  "diagnostic_stage: 'check_existing'",
]) {
  if (!source.includes(needle)) throw new Error(`Missing Kaufland rollover safety guard: ${needle}`);
}

for (const forbidden of [
  /healthyMinimum\s*=\s*Math\.max\(50,\s*Math\.floor\(previousCount\s*\*\s*0\.9\)\)/,
  /products\.length\s*<\s*Math\.floor\(previousCount\s*\*\s*0\.6\)/,
  /oproti předchozím \$\{previousCount\}/,
]) {
  if (forbidden.test(source)) throw new Error(`Historical Kaufland rollover baseline returned: ${forbidden}`);
}

if (!source.includes(".eq('status', 'published').gte('valid_to', today).not('external_id', 'is', null)")) {
  throw new Error('Kaufland live baseline must count only non-expired published offers with external IDs.');
}

if (!source.includes("if (current.length < 50)")) throw new Error('Absolute parser floor must remain in place.');
if (!source.includes("meaningfulCount < Math.floor(current.length * 0.9)")) throw new Error('90% meaningful product guard must remain in place.');
if (!source.includes("v_published < greatest(50")) {
  // This guard lives in the SQL publisher, not this Edge source. Keep this comment explicit so the test does not imply otherwise.
}

console.log('Kaufland live rollover baseline guard OK');
