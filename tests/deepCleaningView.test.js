import test from 'node:test';
test('Empty authorized schedule arrays show verified zero for every state; unavailable schedules stay N/A',()=>{
 const empty=cleaningView({schedules:[],submissions:[]},{});
 assert.equal(empty.summary.rows.length,6);assert.equal(empty.summary.total.completed,0);
 assert.ok(empty.summary.rows.every(row=>row.scheduled===0&&row.completed===0&&row.percentage===null));
 const missing=cleaningView({schedules:null,submissions:[]},{});
 assert.equal(missing.summary.total.completed,0);assert.ok(missing.summary.rows.every(row=>row.completed===0));
 assert.equal(missing.summary.total.scheduled,null);assert.equal(missing.summary.total.pending,null);
 assert.ok(missing.summary.rows.every(row=>row.scheduled===null&&row.percentage===null));
});
import assert from 'node:assert/strict';
import { cleaningView, cleaningPhotoCount, recordedFoName } from '../src/utils/deepCleaningView.js';
const store = {
  id: 'store',
  store_code: 'S1',
  store_name: 'Synthetic Store',
  state: 'TN'
};
const report = {
  schedules: [{
    id: 'a',
    store,
    reporting_state: 'TN',
    display_status: 'Completed',
    submission_ids: ['work']
  }, {
    id: 'b',
    store,
    reporting_state: 'TN',
    display_status: 'Scheduled',
    overdue: true
  }, {
    id: 'c',
    store,
    reporting_state: 'TN',
    display_status: 'Cancelled'
  }],
  submissions: [{
    id: 'work',
    schedule_id: 'a',
    store,
    status: 'submitted',
    final_outcome: 'Completed',
    fo_name: 'Synthetic FO',
    before_count: 2,
    after_count: 1
  }]
};
test('operational KPIs exclude cancelled and Excel reported work', () => {
  const v = cleaningView(report, {
    schedules: [{
      ...report.schedules[0],
      id: 'excel',
      source_kind: 'IFMS_EXCEL'
    }]
  });
  assert.equal(v.summary.total.scheduled, 2);
  assert.equal(v.summary.total.completed, 1);
  assert.equal(v.summary.total.pending, 1);
  assert.equal(v.overdue, 1);
});
test('FO search and submitted status consistently scope schedules and work', () => {
  const v = cleaningView(report, {}, {
    query: 'Synthetic FO',
    status: 'submitted'
  });
  assert.equal(v.work.length, 1);
  assert.equal(v.schedules.length, 1);
  assert.equal(v.summary.total.percentage, 100);
});
test('scheduled filter does not manufacture submitted work or failures', () => {
  const v = cleaningView(report, {}, {
    status: 'Scheduled'
  });
  assert.equal(v.work.length, 0);
  assert.equal(v.summary.total.completed, 0);
  assert.equal(v.overdue, 1);
});
test('zero schedules have no manufactured percentage; missing counts stay unavailable', () => {
  assert.equal(cleaningView({}, {}).summary.total.percentage, null);
  assert.equal(cleaningPhotoCount({}), null);
  assert.equal(cleaningPhotoCount(report.submissions[0]), 3);
  assert.equal(recordedFoName({}), '');
});
test('unlinked completed schedules are not counted as verified completions', () => {
  const v = cleaningView({
    schedules: [{
      ...report.schedules[0],
      submission_ids: []
    }],
    submissions: []
  }, {});
  assert.equal(v.summary.total.completed, 0);
  assert.equal(v.summary.total.pending, 1);
});

test('Completed KPI and chart count confirmed reports independent of verified schedule fulfilment',()=>{
 const standalone={id:'independent',store,status:'submitted',reporting_state:'TN',final_outcome:'Completed'};
 const linkedDone={...report.submissions[0],final_outcome:'Completed'};
 const v=cleaningView({...report,submissions:[linkedDone,standalone,standalone,
  {id:'draft',store,status:'draft'},{id:'failed',store,status:'failed'},
  {id:'unknown-outcome',store,status:'submitted',final_outcome:null},
  {id:'not-done',store,status:'submitted',final_outcome:'Not Done'}]},{});
 assert.equal(v.summary.total.completed,2);
 assert.equal(v.summary.rows.find(row=>row.state==='TN').completed,2);
 assert.equal(v.summary.total.report_completed,2);
 assert.equal(v.summary.rows.find(row=>row.state==='TN').report_completed,2);
 assert.equal(v.summary.total.submitted_reports,4);
 assert.equal(v.summary.total.scheduled_completed,1);
 assert.equal(v.summary.total.scheduled,2);
 assert.equal(v.summary.total.pending,1);
 assert.equal(v.summary.total.percentage,100,'Main completion uses confirmed reports / scheduled jobs');
 assert.equal(v.summary.total.schedule_percentage,50,'Verified schedule fulfilment remains independent');
 const selected=cleaningView({...report,submissions:[standalone]}, {}, {status:'Completed'});
 assert.equal(selected.work.length,1);
 assert.equal(selected.summary.total.completed,1);
 assert.equal(selected.summary.total.report_completed,1);
});

test('November state chart shows 12 AP-1 and 2 TN confirmed reports, excludes NULL outcomes',()=>{
 const states=['TN','AP-1','AP-2','KL','TG','KN'];
 const schedules=states.map((state,i)=>({id:'plan-'+i,store:{id:'s-'+i,store_code:'S'+i,state},reporting_state:state,display_status:'Scheduled'}));
 const submissions=[
  ...Array.from({length:12},(_,i)=>({id:'ap-'+i,store:schedules[1].store,reporting_state:'AP-1',status:'submitted',final_outcome:'Completed',deep_cleaning_date:'2026-11-12'})),
  ...Array.from({length:2},(_,i)=>({id:'tn-'+i,store:schedules[0].store,reporting_state:'TN',status:'submitted',final_outcome:'Completed',deep_cleaning_date:'2026-11-14'})),
  {id:'tg-unknown',store:schedules[4].store,reporting_state:'TG',status:'submitted',final_outcome:null,deep_cleaning_date:'2026-11-07'},
  ...Array.from({length:4},(_,i)=>({id:'ap-uploading-'+i,store:schedules[1].store,reporting_state:'AP-1',status:'uploading',deep_cleaning_date:'2026-11-15'}))
 ];
 const v=cleaningView({schedules,submissions},{});
 assert.equal(v.work.length,19,'All submitted-work records, including uploading, remain visible');
 assert.equal(v.summary.total.completed,14);
 assert.equal(v.summary.total.submitted_reports,15);
 assert.equal(v.summary.total.scheduled_completed,0);
 assert.equal(v.summary.total.pending,6);
 assert.equal(v.summary.total.schedule_percentage,0);
 assert.equal(v.summary.total.percentage,233.3,'Independent visits can exceed scheduled jobs; do not cap the calculation');
 assert.equal(v.summary.rows.find(row=>row.state==='AP-1').completed,12);
 assert.equal(v.summary.rows.find(row=>row.state==='TN').completed,2);
 assert.equal(v.summary.rows.find(row=>row.state==='TG').completed,0);
 assert.ok(v.summary.rows.filter(row=>!['TN','AP-1'].includes(row.state)).every(row=>row.completed===0));
 const scoped=cleaningView({schedules:schedules.slice(1,2),submissions:submissions.filter(row=>row.reporting_state==='AP-1')},{});
 assert.equal(scoped.summary.total.completed,12);
 assert.equal(scoped.summary.total.pending,1);
});

test('confirmed report KPI excludes out-of-range, Excel and linked-only history, retaining duplicate-id protection',()=>{
 const done={id:'current',store,status:'submitted',final_outcome:'Completed',deep_cleaning_date:'2026-11-12'};
 const v=cleaningView({from:'2026-11-01',to:'2026-11-19',schedules:[],submissions:[done,done,
  {...done,id:'old',deep_cleaning_date:'2026-10-31'},
  {...done,id:'future',deep_cleaning_date:'2026-11-20'},
  {...done,id:'historical-link',linked_only:true},
  {...done,id:'excel',source_kind:'IFMS_EXCEL'}]},{});
 assert.equal(v.summary.total.completed,1);
 assert.equal(v.summary.rows.find(r=>r.state==='TN').completed,1);
 assert.equal(v.summary.total.scheduled,0);assert.equal(v.summary.total.percentage,null);
});

function percentageFixture(){
 const ap={id:'ap-store',store_code:'AP-001',store_name:'AP Store',state:'AP-1'};
 const schedules=Array.from({length:423},(_,i)=>({id:'scheduled-'+i,store:i<300?store:ap,reporting_state:i<300?'TN':'AP-1',display_status:'Scheduled',scheduled_date:'2026-11-15',overdue:true}));
 const submissions=Array.from({length:14},(_,i)=>({id:'completed-'+i,store:i<2?store:ap,reporting_state:i<2?'TN':'AP-1',status:'submitted',final_outcome:'Completed',deep_cleaning_date:i<2?'2026-11-14':'2026-11-12'}));
 return {from:'2026-11-01',to:'2026-11-20',schedules,submissions};
}

test('423 scheduled / 14 confirmed reports gives 3.3%; new reports update it without changing pending or overdue',()=>{
 const input=percentageFixture(),v=cleaningView(input,{});
 assert.equal(v.summary.total.percentage,3.3);
 assert.equal(v.summary.total.schedule_percentage,0);
 assert.equal(v.summary.total.pending,423);assert.equal(v.overdue,423);
 const next=cleaningView({...input,submissions:[...input.submissions,{...input.submissions[0],id:'new-completion'}]},{});
 assert.equal(next.summary.total.percentage,3.5);assert.equal(next.summary.total.completed,15);
 assert.equal(next.summary.total.pending,v.summary.total.pending);assert.equal(next.overdue,v.overdue);
 const retry=cleaningView({...input,submissions:[...input.submissions,input.submissions[0]]},{});
 assert.equal(retry.summary.total.completed,14);assert.equal(retry.summary.total.percentage,3.3);
});

test('report-based percentage respects state/store search and actual-date range while schedule fulfilment stays independent',()=>{
 const input=percentageFixture();
 const ap=cleaningView(input,{}, {query:'AP Store'});
 assert.equal(ap.summary.total.completed,12);assert.equal(ap.summary.total.scheduled,123);assert.equal(ap.summary.total.percentage,9.8);
 assert.equal(ap.summary.rows.find(r=>r.state==='AP-1').percentage,9.8);
 const range=cleaningView({...input,from:'2026-11-13'},{});
 assert.equal(range.summary.total.completed,2);assert.equal(range.summary.total.percentage,0.5);
 const linked=structuredClone(input);linked.schedules[0].display_status='Completed';linked.schedules[0].submission_ids=['completed-0'];
 const v=cleaningView(linked,{});
 assert.equal(v.summary.total.percentage,3.3);assert.equal(v.summary.total.schedule_percentage,0.2);
 assert.equal(v.summary.total.pending,422); // Existing verified schedule rules still own Pending.
});

test('zero reports shows 0.0 with a positive denominator; zero or unavailable schedules show no invented percentage',()=>{
 const input=percentageFixture();
 const empty=cleaningView({...input,submissions:[]},{});
 assert.equal(empty.summary.total.percentage.toFixed(1),'0.0');
 for(const schedules of [[],null]){
  const v=cleaningView({...input,schedules},{});
  assert.equal(v.summary.total.percentage,null);assert.equal(v.summary.total.schedule_percentage,null);
 }
});
