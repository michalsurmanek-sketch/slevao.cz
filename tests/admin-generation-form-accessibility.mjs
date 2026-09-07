import fs from 'node:fs';

const html = fs.readFileSync('admin-generovani-fotografii.html', 'utf8');

const required = [
  '<label for="email">E-mail</label>',
  'id="email" name="email" type="email" autocomplete="username" inputmode="email" required',
  '<label for="password">Heslo</label>',
  'id="password" name="password" type="password" autocomplete="current-password" required',
  'id="loginBtn" class="btn primary" type="button"',
  'id="loginMsg" role="status" aria-live="polite"',
  'id="logout" class="btn" type="button"',
  'id="refresh" class="btn" type="button"',
  'id="msg" role="status" aria-live="polite"',
  'id="batchSize" class="btn" aria-label="Velikost dávky"',
  'id="generate" class="btn primary" type="button"',
  'id="runState" class="meta" style="margin-top:12px" role="status" aria-live="polite"',
];

for (const needle of required) {
  if (!html.includes(needle)) {
    throw new Error(`admin-generovani-fotografii.html chybí očekávaný atribut: ${needle}`);
  }
}

console.log('Admin generation form accessibility guard: OK');
