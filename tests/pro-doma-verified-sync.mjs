import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/sync-pro-doma-source/index.ts','utf8');
for(const marker of [
"const SOURCE = 'https://www.pro-doma.cz/akce'",
"const ADAPTER = 'pro-doma-jina-events-v1'",
'https://r.jina.ai/',
'https://img\\.pro-doma\\.cz',
'https://www\\.pro-doma\\.cz',
'\\s+s DPH',
"today<range.from||today>range.to",
'rows.length < 5',
'rows.length>300',
'body.dry_run===true',
'processBatch(urls.slice(i,i+4),today)',
'publish_structured_store_offers',
'p_min_products:5',
'p_max_products:300'
]) if(!src.includes(marker)) throw new Error(`PRO-DOMA guard missing: ${marker}`);
if(!src.includes('current <= 0')&&!src.includes('current<=0')) throw new Error('Positive price guard missing');
if(!src.includes("price_policy:'consumer_price_including_vat'")) throw new Error('VAT price policy missing');
console.log('PRO-DOMA verified sync guards OK');
