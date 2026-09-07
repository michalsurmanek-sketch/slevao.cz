import fs from 'node:fs';

const html = fs.readFileSync('offline.html', 'utf8');

if (/<i[^>]*>\s*%\s*<\/i>/i.test(html) || /class=["']brandMark["'][^>]*>\s*%/i.test(html)) {
  throw new Error('offline.html still contains the legacy percent brand mark');
}

if (!/<div class="logo"><span>SLEVAO<b>\.cz<\/b><\/span><\/div>/.test(html)) {
  throw new Error('offline.html must keep the current SLEVAO.cz text branding');
}

if (!/meta name="robots" content="noindex,nofollow"/.test(html)) {
  throw new Error('offline.html must remain excluded from indexing');
}

console.log('Offline branding guard passed.');
