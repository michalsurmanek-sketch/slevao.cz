import fs from 'node:fs';

const html = fs.readFileSync('admin-nahrat-letaky.html', 'utf8');

const required = [
  'id="authState" class="loginState hidden" role="status" aria-live="polite"',
  'id="uploadMessage" class="message info" role="status" aria-live="polite" hidden',
  'id="uploadCount" class="statusPill" role="status" aria-live="polite"',
  'meta name="robots" content="noindex,nofollow,noarchive"',
  'id="dropZone" class="dropZone" role="button" tabindex="0" aria-label="Vybrat nebo přetáhnout letáky"',
];

for (const needle of required) {
  if (!html.includes(needle)) {
    throw new Error(`admin-nahrat-letaky.html chybí očekávaná statická ochrana: ${needle}`);
  }
}

console.log('Admin manual leaflet upload status accessibility guard: OK');
