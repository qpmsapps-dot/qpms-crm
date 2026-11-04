import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAttendance} from '../backend/shared/retailAttendance.js';
const stores=[{id:'s1',state:'TN'},{id:'s2',state:'KL'}];
const aop=stores.map(s=>({retail_store_id:s.id,hk_count:2,mepc_count:1,effective_from:'2026-10-01'}));
const attendance=[{retail_store_id:'s1',attendance_date:'2026-10-02',class:'HK',credit:1},{retail_store_id:'s2',attendance_date:'2026-10-03',class:'MEPC',credit:0}];
test('covered percentages match class/store/date targets without converting missing uploads into zero',()=>{
 const r=summarizeAttendance({stores,aop,attendance,cutoff:'2026-10-03'});
 assert.equal(r.total.overall_pct,null);assert.equal(r.total.coverage.hk.percentage,50);
 assert.equal(r.total.coverage.mepc.percentage,0);assert.ok(Math.abs(r.total.coverage.overall.percentage-100/3)<1e-10);
 assert.equal(r.total.coverage.hk.covered_store_days,1);
 assert.equal(r.states.find(s=>s.state==='TN').coverage.mepc.percentage,null);
});
test('daily and MTD coverage use their own period and approved effective dates',()=>{
 const daily=summarizeAttendance({stores,aop,attendance,cutoff:'2026-10-03',view:'daily'});
 assert.equal(daily.total.coverage.hk.percentage,null);assert.equal(daily.total.coverage.mepc.percentage,0);
 const unapproved=summarizeAttendance({stores,aop:aop.map(a=>({...a,effective_from:'2026-10-03'})),attendance,cutoff:'2026-10-03'});
 assert.equal(unapproved.total.coverage.hk.percentage,null);
});
test('zero-target and ambiguous AOP never generate a percentage',()=>{
 const r=summarizeAttendance({stores,aop:[...aop,aop[0]],attendance,cutoff:'2026-10-03'});
 assert.equal(r.total.coverage.hk.percentage,null);
 const zero=summarizeAttendance({stores,aop:aop.map(a=>({...a,hk_count:0})),attendance,cutoff:'2026-10-03'});
 assert.equal(zero.total.coverage.hk.percentage,null);
});
