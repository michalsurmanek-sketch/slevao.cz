import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/discover-product-images-smart/index.ts', 'utf8');

if (!source.includes("const automatic=who==='cron'||who==='service-role'")) {
  throw new Error('image automation must classify cron and service-role as automatic callers');
}
if (!source.includes("if(automatic&&settings?.enabled===false)")) {
  throw new Error('disabled image automation must block every automatic caller');
}
if (!source.includes("if(automatic&&await recentBillingBlock())")) {
  throw new Error('billing guard must also protect every automatic caller');
}

console.log('image automation service guard OK');
