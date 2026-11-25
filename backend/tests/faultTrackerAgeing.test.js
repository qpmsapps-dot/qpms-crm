import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgeingReports,ageingBand,ageingExportRows,AGEING_COLUMNS} from '../../src/utils/faultTrackerAgeing.js';
const t=(groupedState,ifmsStage,ageingDays)=>({groupedState,ifmsStage,ageingDays});
test('ageing boundaries include zero, missing and invalid values',()=>{
 for(const [d,band] of [[0,'0–3'],[3,'0–3'],[4,'4–7'],[7,'4–7'],[8,'8–15'],[15,'8–15'],[16,'16–30'],[30,'16–30'],[31,'31–60'],[60,'31–60'],[61,'61–90'],[90,'61–90'],[91,'>90'],[null,'Unknown'],['','Unknown'],[-1,'Unknown']])assert.equal(ageingBand(t('KL','CAMC',d)),band);
 assert.equal(ageingBand({...t('KL','CAMC',0),ageingSourceDays:null}),'Unknown');
});
test('stage and state summaries reconcile all tickets, weighted average and scoped drill-down',()=>{
 const tickets=[t('KL','CAMC',100),t('KL','HK',20),t('PY','Pest Control',0),t('KA','Work Completed - Call Yet to Close',10),t('TG','IN_PROGRESS',null),t('AP-1','OEM',30)];
 const all=buildAgeingReports(tickets),kl=buildAgeingReports(tickets,'KL');
 assert.equal(all.stages.at(-1).total,6);assert.equal(all.states.at(-1).total,6);
 assert.equal(all.states.at(-1).average,32);assert.equal(all.states.at(-1).oldest,100);
 assert.equal(kl.stages.at(-1).total,2);assert.equal(kl.states.at(-1).total,6);
 assert.equal(kl.stages.find(r=>r.label==='CAMC').tickets[0],tickets[0]);
 assert.equal(all.stages.find(r=>r.label==='Unmapped / source stage').bands.Unknown,1);
 assert.equal(all.states.find(r=>r.label==='TN & PY').total,1);
 assert.equal(all.states.find(r=>r.label==='KA').total,1);
 for(const r of [...all.stages,...all.states])assert.equal(AGEING_COLUMNS.reduce((n,k)=>n+r.bands[k],0),r.total);
 for(const compact of [false,true]){const rows=ageingExportRows(compact?all.states:all.stages,compact);assert.ok(rows.every(r=>r.length===rows[0].length));assert.equal(rows.at(-1)[1],6);}
});
