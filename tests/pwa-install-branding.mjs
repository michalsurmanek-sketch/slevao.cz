import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/pwa-install.js', import.meta.url), 'utf8');

assert.doesNotMatch(source, /sfInstallPrompt__icon/, 'PWA install prompt must not restore the legacy percent brand icon.');
assert.doesNotMatch(source, /<div class="sfInstallPrompt__icon">%<\/div>/, 'PWA install prompt must not display a percent logo.');
assert.match(source, /grid-template-columns:1fr auto/, 'PWA install prompt must keep the two-column layout after icon removal.');
assert.match(source, /\.sfInstallPrompt__install\{grid-column:1;/, 'Install action must remain aligned in the content column.');
assert.match(source, /\.sfInstallPrompt__close\{grid-column:2;/, 'Close action must remain in the second column.');
assert.match(source, /<strong>Přidat Slevao na plochu<\/strong>/, 'Slevao text identity must remain in the install prompt.');

console.log('PWA install branding guard OK.');
