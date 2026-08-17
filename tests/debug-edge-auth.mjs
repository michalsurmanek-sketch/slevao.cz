import fs from 'node:fs';

const config = fs.readFileSync('supabase/config.toml', 'utf8');
const source = fs.readFileSync('supabase/functions/debug-makro-public-source/index.ts', 'utf8');

if (!/\[functions\.debug-makro-public-source\][\s\S]*?verify_jwt\s*=\s*true/.test(config)) {
  throw new Error('debug-makro-public-source must require JWT in supabase/config.toml');
}
if (!source.includes("https://sortiment.makro.cz/cs/catalog/category/action")) {
  throw new Error('tracked Makro debug endpoint source is missing or unexpected');
}

console.log('debug edge auth regression OK');
