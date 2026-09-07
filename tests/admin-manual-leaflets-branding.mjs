import fs from 'node:fs';

const html = fs.readFileSync('admin-nahrat-letaky.html', 'utf8');

if (/<span\s+class=["']brandMark["'][^>]*>\s*%\s*<\/span>/i.test(html)) {
  throw new Error('admin-nahrat-letaky.html still contains the legacy percent brand mark');
}

if (!/class=["']brand["'][^>]*>\s*<span>SLEVAO<b>\.cz<\/b><\/span>/i.test(html)) {
  throw new Error('admin-nahrat-letaky.html must keep the current SLEVAO.cz text branding');
}

console.log('Admin manual leaflet branding guard passed.');
