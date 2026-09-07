import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const legacy = '<span class="brandMark">%</span>';
if (html.includes(legacy)) {
  throw new Error('Homepage branding must not contain the legacy percent brand mark.');
}

const cleanLogo = '<span>SLEVAO<b>.cz</b></span>';
const logoCount = html.split(cleanLogo).length - 1;
if (logoCount < 2) {
  throw new Error(`Expected clean SLEVAO.cz text branding in header and footer, found ${logoCount}.`);
}

const topLogo = '<a class="brand" href="#top" aria-label="Slevao.cz domů"><span>SLEVAO<b>.cz</b></span></a>';
const footerLogo = '<a class="brand footerBrand" href="#top" aria-label="Slevao.cz domů"><span>SLEVAO<b>.cz</b></span></a>';
if (!html.includes(topLogo)) throw new Error('Clean homepage header logo is missing.');
if (!html.includes(footerLogo)) throw new Error('Clean homepage footer logo is missing.');

console.log('Homepage branding guard OK.');
