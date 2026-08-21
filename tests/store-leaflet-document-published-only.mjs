import fs from 'node:fs';

const path = 'supabase/functions/store-leaflet-document/index.ts';
if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
const source = fs.readFileSync(path, 'utf8');

if (!source.includes("const allowedStatuses = new Set(['published']);")) {
  throw new Error('Public leaflet document import_id path must allow only published imports.');
}
if (/allowedStatuses\s*=\s*new Set\(\[[^\]]*['\"]review['\"]/i.test(source)) {
  throw new Error('Review imports must not be public through store-leaflet-document.');
}
if (/allowedStatuses\s*=\s*new Set\(\[[^\]]*['\"]publishing['\"]/i.test(source)) {
  throw new Error('Publishing imports must not be public through store-leaflet-document.');
}
for (const needle of [
  "store?.is_active === false",
  "function pragueToday(): string",
  "timeZone: 'Europe/Prague'",
  "new Intl.DateTimeFormat('en-CA'",
  "job.detected_valid_to && job.detected_valid_to < pragueToday()",
  "officialPublicDocument(requestUrl.searchParams.get('source_url') || '')"
]) {
  if (!source.includes(needle)) throw new Error(`Existing public leaflet guard disappeared: ${needle}`);
}
if (source.includes("new Date().toISOString().slice(0, 10)")) {
  throw new Error('Leaflet document expiry must not derive the business day from UTC.');
}

console.log('store-leaflet-document: published-only Prague import boundary OK');
