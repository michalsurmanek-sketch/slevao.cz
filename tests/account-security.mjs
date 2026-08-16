import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/account.js', import.meta.url), 'utf8');

assert.match(source, /function\s+safeRedirectTarget\s*\(/, 'Account must sanitize redirect targets.');
assert.match(source, /target\.origin\s*!==\s*location\.origin/, 'External redirect origins must be rejected.');
assert.match(source, /raw\.startsWith\('\/\/'\)/, 'Protocol-relative redirects must be rejected.');
assert.match(source, /relative\.startsWith\('admin'\)/, 'Account redirects must not enter admin routes.');
assert.doesNotMatch(source, /const\s+redirect\s*=\s*params\.get\('redirect'\)\s*\|\|/, 'Raw redirect query parameter must never be used directly.');

console.log('account-security: ok');
