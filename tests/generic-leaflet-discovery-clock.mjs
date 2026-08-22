import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/run-leaflet-pipeline-v2/index.ts', 'utf8');

assert(source.includes("async function markSourceFailure(sourceId:string,message:string,touchChecked=true)"), 'Failure marker must distinguish a real source check from a verification-only failure.');
assert(source.includes("if(touchChecked)update.last_checked_at=new Date().toISOString()"), 'Only real checks may advance last_checked_at.');
assert(source.includes("async function markGenericVerificationSuccess(sourceId:string,strategy:string)"), 'Generic verification success must have a timestamp-preserving health marker.');
assert(!source.match(/markGenericVerificationSuccess[^}]+last_checked_at/), 'Generic verification success must not advance last_checked_at.');
assert(!source.match(/markGenericVerificationSuccess[^}]+last_success_at/), 'Generic verification success must not impersonate a real discovery success.');
assert(source.includes("await markGenericVerificationSuccess(String(source.source_id),'generic-products-and-documents-verified')"), 'Generic successful verification must preserve the discovery clock.');
assert(source.includes("markSourceFailure(String(source.source_id),message,false)"), 'Generic verification failures must preserve the discovery clock.');
assert.equal((source.match(/markSourceFailure\(String\(source\.source_id\),message,false\)/g) || []).length, 2, 'Both generic failure paths must preserve last_checked_at.');
assert(source.includes("await markSourceFailure(String(source.source_id),message);return{store:slug"), 'Specialized adapter failures must still record their real check time.');
assert(source.includes("const result=await invoke('discover-leaflets')"), 'Generic pipeline must continue to use the canonical discover-leaflets adapter.');
assert(!source.includes("markSourceFailure(String(source.source_id),message);}}return{stores:slugs"), 'Per-source generic verification must not use the legacy clock-advancing failure call.');

console.log('Generic leaflet verification preserves discovery due clock OK');
