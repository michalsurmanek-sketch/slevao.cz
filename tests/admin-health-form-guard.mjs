import fs from 'node:fs';

const html = fs.readFileSync('admin-zdravi-automatizace.html', 'utf8');

const required = [
  'id="email"',
  'name="email"',
  'autocomplete="username"',
  'inputmode="email"',
  'id="password"',
  'name="password"',
  'autocomplete="current-password"',
  'id="loginBtn" class="btn primary" type="button"',
  'id="loginMsg" class="muted" role="status" aria-live="polite"',
  'id="refresh" class="btn primary" type="button"',
];

for (const needle of required) {
  if (!html.includes(needle)) {
    throw new Error(`admin-zdravi-automatizace.html chybí očekávaný atribut: ${needle}`);
  }
}

if (!/id="email"[^>]*required/.test(html)) throw new Error('E-mail musí být required.');
if (!/id="password"[^>]*required/.test(html)) throw new Error('Heslo musí být required.');

console.log('Admin health login form guard: OK');
