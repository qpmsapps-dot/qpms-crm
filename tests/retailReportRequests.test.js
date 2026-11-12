import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/pages/reliance-retail/RetailScopedDeepCleaning.jsx',import.meta.url),'utf8');
test('actual evidence request function deduplicates in-flight clicks, aborts superseded reads and never caches signed evidence',async()=>{
 const begin=source.indexOf('  async function inspect('),end=source.indexOf('  const excel',begin);
 assert.ok(begin>=0&&end>begin);
 const flight={current:null},version={current:0},calls=[],values=[];
 const api=options=>new Promise((resolve,reject)=>{
  calls.push({options,resolve});options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
 });
 const build=Function('evidenceFlight','evidenceRequest','authenticatedApiRequest','setSelected','setEvidenceError','setEvidence','setEvidenceBusy','view','from','to','state','store',source.slice(begin,end)+'; return inspect;');
 const inspect=build(flight,version,api,()=>{},()=>{},v=>values.push(v),()=>{},{work:[]},'2026-10-01','2026-10-31','','');
 const first=inspect('a');await inspect('a');assert.equal(calls.length,1);
 const second=inspect('b');assert.equal(calls[0].options.signal.aborted,true);
 calls[1].resolve({data:{uploads:['new']}});await Promise.all([first,second]);assert.deepEqual(values.at(-1),['new']);
 const fresh=inspect('b');assert.equal(calls.length,3);calls[2].resolve({data:{uploads:['fresh']}});await fresh;
 assert.deepEqual(values.at(-1),['fresh']);assert.equal(flight.current,null);
});
test('report cleanup cancels requests and offscreen photos are lazy without caching mutation results',()=>{
 assert.match(source,/signal: controller\.signal/);assert.match(source,/controller\.abort\(\)/);
 assert.match(source,/Promise\.resolve\(\)\.then\(\(\) => live \?/);
 const drawer=readFileSync(new URL('../src/components/reliance-retail/DeepCleaningEvidenceDrawer.jsx',import.meta.url),'utf8');
 assert.match(drawer,/<img loading="lazy" decoding="async"/);
});
