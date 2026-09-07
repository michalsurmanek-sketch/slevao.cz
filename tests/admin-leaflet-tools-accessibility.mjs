import fs from 'node:fs';

const imageHtml = fs.readFileSync('admin-obrazky-letaku.html', 'utf8');
const visibilityHtml = fs.readFileSync('admin-viditelnost-letaku.html', 'utf8');

const imageRequired = [
  'id="email" name="email" type="email" autocomplete="username" inputmode="email" required',
  'id="password" name="password" type="password" autocomplete="current-password" required',
  'id="loginMsg" role="status" aria-live="polite"',
  'id="storeSearch" type="search" placeholder="Hledat obchod nebo slug…" aria-label="Hledat obchod"',
  'id="message" role="status" aria-live="polite"',
  'target="_blank" rel="noopener"',
];

const visibilityRequired = [
  'id="email" name="email" type="email" autocomplete="username" inputmode="email" required',
  'id="password" name="password" type="password" autocomplete="current-password" required',
  'id="loginMsg" class="visibilityMessage" role="status" aria-live="polite"',
  'id="search" class="search" type="search" placeholder="Hledat kartu obchodu…" aria-label="Hledat kartu obchodu"',
  'id="message" class="visibilityMessage" role="status" aria-live="polite"',
  'target="_blank" rel="noopener"',
];

for (const needle of imageRequired) {
  if (!imageHtml.includes(needle)) throw new Error(`admin-obrazky-letaku.html chybí: ${needle}`);
}
for (const needle of visibilityRequired) {
  if (!visibilityHtml.includes(needle)) throw new Error(`admin-viditelnost-letaku.html chybí: ${needle}`);
}

console.log('Admin leaflet tools accessibility guard: OK');
