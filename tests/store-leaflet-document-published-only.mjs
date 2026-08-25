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
  "officialPublicDocument(requestUrl.searchParams.get('source_url') || '')",
  "function isTetaListingUrl(value: string): boolean",
  "'/akce/letak'",
  "function tetaViewerFromHtml(html: string): string | null",
  "const viewerUrl = await resolveTetaViewer(sourceUrl);",
  "https://www.tetadrogerie.cz/akce/letak"
]) {
  if (!source.includes(needle)) throw new Error(`Existing public leaflet guard disappeared: ${needle}`);
}
if (source.includes("new Date().toISOString().slice(0, 10)")) {
  throw new Error('Leaflet document expiry must not derive the business day from UTC.');
}
if (/resolveTetaPdf\(viewerUrl: string\)[\s\S]{0,250}if \(!isTetaViewerUrl\(viewerUrl\)\) throw/.test(source)) {
  throw new Error('Teta campaign/listing imports must resolve through the current official leaflet page instead of failing with 502.');
}

console.log('store-leaflet-document: published-only Prague and Teta fallback boundary OK');
