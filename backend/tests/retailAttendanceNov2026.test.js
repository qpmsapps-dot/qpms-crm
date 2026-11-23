import test from 'node:test';
import assert from 'node:assert/strict';
import {novemberStateAttendanceSummary,NOVEMBER_2026_STATE_AOP} from '../shared/retailAttendanceNov2026.js';
import {summarizeAttendance} from '../shared/retailAttendance.js';

const stores=[
  {id:'ap1',store_code:'A1',store_name:'AP1',state:'AP-1'},
  {id:'ap2',store_code:'A2',store_name:'AP2',state:'AP-2'},
  {id:'tn',store_code:'TN',store_name:'TN',state:'TN'},
  {id:'py',store_code:'PY',store_name:'PY',state:'PY'},
];
const attendance=(store,date,kind,count=1)=>({retail_store_id:store,attendance_date:date,class:kind,credit:count});

test('November daily targets come only from temporary state constants, not missing store AOP',()=>{
  const data=[attendance('ap2','2026-11-23','HK',250),attendance('ap2','2026-11-23','MEPC',43)];
  const report=novemberStateAttendanceSummary({stores:[stores[1]],attendance:data,cutoff:'2026-11-23',view:'daily'});
  assert.equal(report.states[0].hk_aop,274);
  assert.equal(report.states[0].mepc_aop,47);
  assert.equal(report.total.hk_target,274);
  assert.equal(report.total.mepc_target,47);
  assert.equal(report.total.hk_actual,250);
  assert.equal(report.total.mepc_actual,43);
  assert.equal(report.total.complete,true);
  assert.equal(report.total.overall_pct,293/321*100);
  assert.equal(report.state_aop_source,'nov_2026_central_mis_temporary');
});

test('22 November MTD deducts three MEPC weekly offs and none from HK',()=>{
  const data=[];
  for(let day=1;day<=22;day++){
    const date=`2026-11-${String(day).padStart(2,'0')}`;
    data.push(attendance('ap1',date,'HK',120));
    data.push(attendance('ap1',date,'MEPC',25));
  }
  const report=novemberStateAttendanceSummary({stores:[stores[0]],attendance:data,cutoff:'2026-11-22'});
  assert.equal(report.total.hk_target,3565.1);
  assert.equal(report.total.mepc_target,570);
  assert.equal(report.total.hk_actual,2640);
  assert.equal(report.total.mepc_actual,550);
  assert.equal(report.total.total_target,4135.1);
  assert.equal(report.total.complete,true);
  assert.equal(report.total.missing_dates.length,0);
});

test('November 1-16 uses 14 eligible MEPC days, not 16',()=>{
  const data=[];
  for(let day=1;day<=16;day++){
    const date=`2026-11-${String(day).padStart(2,'0')}`;
    data.push(attendance('ap1',date,'HK',1));
    data.push(attendance('ap1',date,'MEPC',1));
  }
  const report=novemberStateAttendanceSummary({stores:[stores[0]],attendance:data,cutoff:'2026-11-16'});
  assert.equal(report.total.hk_target,2592.8);
  assert.equal(report.total.mepc_target,420);
  assert.equal(report.total.complete,true);
});

test('Missing uploaded classes or dates remain N/A, never fabricated absence',()=>{
  const report=novemberStateAttendanceSummary({stores:[stores[0]],attendance:[attendance('ap1','2026-11-03','HK',10)],cutoff:'2026-11-03',view:'daily'});
  assert.equal(report.total.missing_dates.length,1);
  assert.equal(report.total.complete,false);
  assert.equal(report.total.mepc_pct,null);
  assert.equal(report.total.overall_pct,null);
});

test('On the seventh and eighth days daily MEPC AOP remains normal, actuals are never discarded',()=>{
  for(const day of [7,8,14,15,21,22,28,29]){
    const date=`2026-11-${String(day).padStart(2,'0')}`;
    const report=novemberStateAttendanceSummary({
      stores:[stores[0]],attendance:[attendance('ap1',date,'HK',100),attendance('ap1',date,'MEPC',30)],
      cutoff:date,view:'daily'
    });
    assert.equal(report.total.hk_target,162.05);
    assert.equal(report.total.mepc_target,30);
    assert.equal(report.total.mepc_actual,30);
    assert.equal(report.total.total_actual,130);
    assert.equal(report.total.missing_dates.length,0);
    assert.equal(report.total.complete,true);
  }
});

test('MEPC MTD eligibility follows the Central MIS boundaries, not zero-AOP calendar dates',()=>{
  const data=[];
  for(let day=1;day<=30;day++){
    const date=`2026-11-${String(day).padStart(2,'0')}`;
    data.push(attendance('ap1',date,'HK',120),attendance('ap1',date,'MEPC',30));
  }
  const eligibleByDay=new Map([[1,1],[2,2],[6,6],[7,7],[8,7],[9,8],[13,12],
    [14,13],[15,13],[16,14],[20,18],[21,19],[22,19],[23,20],[27,24],
    [28,25],[29,25],[30,26]]);
  for(const [day,eligible] of eligibleByDay){
    const report=novemberStateAttendanceSummary({stores:[stores[0]],attendance:data,
      cutoff:`2026-11-${String(day).padStart(2,'0')}`,view:'mtd'});
    assert.equal(report.total.mepc_target,eligible*30,`MEPC cumulative target on November ${day}`);
    assert.equal(report.total.hk_target,162.05*day,`HK target November ${day}`);
    assert.equal(report.total.mepc_actual,day*30,`MEPC actual attendance must include all days to ${day}`);
    assert.equal(report.total.complete,true);
  }
});

test('Report totals cover authorized states only, and consolidate PY into TN',()=>{
  const report=novemberStateAttendanceSummary({stores:[stores[0],stores[2],stores[3]],attendance:[attendance('tn','2026-11-01','HK',2),attendance('py','2026-11-01','MEPC',3),attendance('ap1','2026-11-01','HK',1)],cutoff:'2026-11-01',view:'daily'});
  assert.deepEqual(report.states.map(row=>row.state),['AP-1','TN']);
  assert.equal(report.states.find(row=>row.state==='TN').hk_aop,296.5);
  assert.equal(report.states.find(row=>row.state==='TN').mepc_aop,56);
  assert.equal(report.states.find(row=>row.state==='TN').hk_actual,2);
  assert.equal(report.states.find(row=>row.state==='TN').mepc_actual,3);
  assert.equal(report.total.hk_aop,458.55);
});

test('Temporary AOP is exactly six states, December falls through untouched',()=>{
  assert.equal(Object.keys(NOVEMBER_2026_STATE_AOP).length,6);
  assert.equal(novemberStateAttendanceSummary({stores,attendance:[],cutoff:'2026-12-01'}),null);
  assert.equal(novemberStateAttendanceSummary({stores,attendance:[],cutoff:'2026-10-31'}),null);
  const baseline=summarizeAttendance({stores:[stores[0]],attendance:[],aop:[],cutoff:'2026-10-31',view:'daily'});
  assert.equal(baseline.total.overall_pct,null);
  assert.equal(baseline.total.missing_aop.length,1);
});
