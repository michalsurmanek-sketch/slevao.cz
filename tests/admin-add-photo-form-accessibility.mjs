import fs from 'node:fs';

const html = fs.readFileSync('admin-pridat-fotografii.html', 'utf8');

const checks = [
  [/meta name="robots" content="noindex,nofollow,noarchive"/, 'noindex robots meta'],
  [/label for="email">E-mail<\/label><input id="email" name="email" type="email" autocomplete="username" inputmode="email" required>/, 'email login semantics'],
  [/label for="password">Heslo<\/label><input id="password" name="password" type="password" autocomplete="current-password" required>/, 'password login semantics'],
  [/button id="loginBtn" class="btn primary" type="button"/, 'login button type'],
  [/button id="logout" class="btn" type="button"/, 'logout button type'],
  [/label id="pageUrlLabel" for="pageUrl"/, 'page URL label binding'],
  [/button id="inspect" class="btn primary" type="button"/, 'inspect button type'],
  [/div id="loginMsg" role="status" aria-live="polite"/, 'login live region'],
  [/div id="autoMsg" role="status" aria-live="polite"/, 'automatic discovery live region'],
  [/div id="uploadMsg" role="status" aria-live="polite"/, 'upload live region'],
  [/div id="msg" role="status" aria-live="polite"/, 'page inspection live region'],
];

for (const [pattern, label] of checks) {
  if (!pattern.test(html)) throw new Error(`Missing ${label} in admin-pridat-fotografii.html`);
}

console.log('Admin add-photo accessibility guard passed.');
