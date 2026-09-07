import crypto from 'node:crypto';
import fs from 'node:fs';

const html = fs.readFileSync('admin-zdravi-automatizace.html', 'utf8');

const required = [
  'id="email"',
  'name="email"',
  'autocomplete="username"',
  'inputmode="email"',
  'aria-label="E-mail"',
  'id="password"',
  'name="password"',
  'autocomplete="current-password"',
  'aria-label="Heslo"',
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

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const inlineScript = scripts.at(-1)?.[1] ?? '';
const inlineScriptHash = crypto.createHash('sha256').update(inlineScript).digest('hex');
const expectedInlineScriptHash = '7d7af54fbf3389b803278af3a00f076894a5b1736bd69e3cc84b75e35f3118ff';

if (inlineScriptHash !== expectedInlineScriptHash) {
  throw new Error(`Inline Supabase/auth logika se změnila: ${inlineScriptHash}`);
}

console.log('Admin health form guard: OK');
