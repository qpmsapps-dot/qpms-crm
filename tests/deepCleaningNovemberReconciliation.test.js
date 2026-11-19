// Synthetic reporting fixtures only. No SDK, environment files or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleaningReport} from '../backend/shared/retailModuleReports.js';
import {summarizeVerifiedCleaningSchedules} from '../src/utils/retailStatePerformance.js';

const reason='Reviewed original paired evidence and both unchanged November dates';
function fixture(){
  const stores=[],schedules=[];
  for(const [state,count] of [['AP-1',41],['AP-2',53],['KL',69],['TG',45]]){
    for(let n=0;n<count;n++){
      const id=state+'-'+n;
      stores.push({id,store_code:id,state,store_name:'Same display name'});
      schedules.push({id:'plan-'+id,retail_store_id:id,scheduled_date:'2026-11-10',status:'Planned'});
    }
  }
  const source=(id,n,date)=>({id,retail_store_id:'AP-1-'+n,store_code:'AP-1-'+n,state:'AP-1',status:'submitted',final_outcome:'Completed',deep_cleaning_date:date,submitted_at:'2026-11-19T04:00:00Z',metadata:{contract_version:'cleaning-independent.phase1b.v1'}});
  const deep_cleaning=[source('first',0,'2026-11-12'),source('second',1,'2026-11-13'),source('third',2,'2026-11-17'),source('duplicate-visit-a',3,'2026-11-12'),source('duplicate-visit-b',3,'2026-11-19')];
  return {stores,schedules,deep_cleaning,images:[],to:'2026-11-30'};
}
// Models the result of an already authorized database link, never authorizes it.
function linked(snapshot,sourceId){
  const source=snapshot.deep_cleaning.find(s=>s.id===sourceId);
  const plan=snapshot.schedules.find(p=>p.retail_store_id===source.retail_store_id);
  plan.status='Completed';
  plan.metadata={verified_link_contract:'cleaning-match.manual.v2',verified_submission_id:source.id,verified_actual_date:source.deep_cleaning_date,manual_reason:reason};
}

test('November four-state schedules never complete from store names or unlinked different-date reports',()=>{
  const input=fixture(),result=cleaningReport(input);
  assert.equal(result.summary.total.scheduled,208);
  assert.equal(result.summary.total.scheduled_completed,0);
  assert.equal(result.summary.total.pending,208);
  assert.equal(result.submissions.length,5,'Independent work remains reportable');
});

test('explicit verified links count one schedule per store and keep chart, percentage and original dates consistent',()=>{
  const input=fixture(),originalDates=input.deep_cleaning.map(s=>s.deep_cleaning_date);
  for(const id of ['first','second','third','duplicate-visit-a'])linked(input,id);
  input.deep_cleaning.push({...input.deep_cleaning[3]}); // Retry repeats the same source identity.
  const result=cleaningReport(input),chart=summarizeVerifiedCleaningSchedules(result.schedules);
  const ap1=result.summary.rows.find(r=>r.state==='AP-1');
  assert.deepEqual([ap1.scheduled,ap1.scheduled_completed,ap1.pending,ap1.percentage],[41,4,37,9.8]);
  const bar=chart.rows.find(r=>r.state==='AP-1');
  assert.deepEqual([bar.scheduled,bar.completed,bar.pending,bar.percentage],[41,4,37,9.8]);
  assert.equal(chart.total.completed,result.summary.total.scheduled_completed);
  assert.equal(result.schedules.filter(p=>p.display_status==='Completed').length,4);
  assert.deepEqual(result.schedules.find(p=>p.retail_store_id==='AP-1-3').submission_ids,['duplicate-visit-a']);
  assert.deepEqual(input.deep_cleaning.slice(0,5).map(s=>s.deep_cleaning_date),originalDates);
  assert.ok(input.schedules.every(p=>p.scheduled_date==='2026-11-10'));
  for(const state of ['AP-2','KL','TG'])assert.equal(chart.rows.find(r=>r.state===state).completed,0);
});

test('automatic matching still requires exact dates; incomplete or unverified sources cannot acquire exception completion',()=>{
  for(const change of [{status:'draft'},{final_outcome:null},{metadata:{}},{retail_store_id:'TG-0',state:'TG'},{store_code:'AP-2-0',state:'AP-2'}]){
    const input=fixture();linked(input,'first');Object.assign(input.deep_cleaning[0],change);
    assert.equal(cleaningReport(input).summary.total.scheduled_completed,0);
  }
  const input=fixture();linked(input,'first');
  input.schedules[0].metadata.verified_link_contract='cleaning-match.v2';
  assert.equal(cleaningReport(input).summary.total.scheduled_completed,0,'No automatic same-month date relaxation');
  input.schedules[0].metadata={};
  assert.equal(cleaningReport(input).summary.total.scheduled_completed,0,'A Completed label alone is not evidence');
});

test('state and canonical-store filters retain AP-1/AP-2 separation after a date exception',()=>{
  const input=fixture();linked(input,'first');
  const ap2=cleaningReport(input,{state:'AP-2'});
  assert.deepEqual([ap2.summary.total.scheduled,ap2.summary.total.scheduled_completed,ap2.submissions.length],[53,0,0]);
  const selected=cleaningReport(input,{state:'AP-1',store:'AP-1-0'});
  assert.deepEqual([selected.summary.total.scheduled,selected.summary.total.scheduled_completed],[1,1]);
  assert.equal(cleaningReport(input,{state:'AP-1',store:'AP-2-0'}).schedules.length,0);
});
