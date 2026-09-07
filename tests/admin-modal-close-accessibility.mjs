import fs from 'node:fs';

const html = fs.readFileSync('admin-tesco-kontrola.html', 'utf8');
const closeButtons = [...html.matchAll(/<button\b[^>]*class="[^"]*\bcloseButton\b[^"]*"[^>]*>/g)].map(match => match[0]);

if (!closeButtons.length) {
  throw new Error('Nebyla nalezena žádná closeButton tlačítka.');
}

for (const button of closeButtons) {
  const hasAccessibleName = /\baria-label="[^"]+"/.test(button) || /\baria-labelledby="[^"]+"/.test(button) || /\btitle="[^"]+"/.test(button);
  if (!hasAccessibleName) {
    throw new Error(`Zavírací tlačítko nemá přístupný název: ${button}`);
  }
  if (!/\btype="button"/.test(button)) {
    throw new Error(`Zavírací tlačítko nemá type="button": ${button}`);
  }
}

console.log(`Admin modal close accessibility guard: OK (${closeButtons.length})`);
