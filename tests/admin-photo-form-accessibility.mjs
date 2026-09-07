import fs from 'node:fs';

const html = fs.readFileSync('admin-fotografie.html', 'utf8');

const required = [
  '<label for="email">E-mail</label>',
  'id="email" name="email" type="email" autocomplete="username" inputmode="email" required',
  '<label for="password">Heslo</label>',
  'id="password" name="password" type="password" autocomplete="current-password" required',
  'id="loginBtn" class="btn primary" type="button"',
  'id="loginMsg" role="status" aria-live="polite"',
  'id="logout" class="btn" type="button"',
  'id="refresh" class="btn primary" type="button"',
  'id="deleteAllImages" class="btn bad" type="button"',
  'id="storeFilter" class="btn" aria-label="Filtrovat podle obchodu"',
  'id="discover" class="btn primary" type="button"',
  'id="msg" role="status" aria-live="polite"',
  'target="_blank" rel="noopener"',
];

for (const needle of required) {
  if (!html.includes(needle)) {
    throw new Error(`admin-fotografie.html chybí očekávaný atribut: ${needle}`);
  }
}

console.log('Admin photo form accessibility guard: OK');
