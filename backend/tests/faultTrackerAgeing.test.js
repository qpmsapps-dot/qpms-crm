import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgeingReports,ageingBand,ageingValue,ageingRegion,ageingDetailTickets,ageingTicketExportRows,ageingExportRows,AGEING_COLUMNS,AGEING_REGIONS,AGEING_SHEET_NAMES} from '../../src/utils/faultTrackerAgeing.js';
import {RETAIL_FAULT_STAGES} from '../shared/retailFaultWorkflow.js';
import * as XLSX from 'xlsx';
const t=(groupedState,ifmsStage,ageingDays)=>({groupedState,ifmsStage,ageingDays});
test('ageing boundaries include zero, missing and invalid values',()=>{
 for(const [d,band] of [[0,'0–3'],[3,'0–3'],[4,'4–7'],[7,'4–7'],[8,'8–15'],[15,'8–15'],[16,'16–30'],[30,'16–30'],[31,'31–60'],[60,'31–60'],[61,'61–90'],[90,'61–90'],[91,'>90'],[null,'Unknown'],['','Unknown'],[-1,'Unknown']])assert.equal(ageingBand(t('KL','CAMC',d)),band);
 assert.equal(ageingBand({...t('KL','CAMC',0),ageingSourceDays:null}),'Unknown');
});

test('invalid ages are Unknown rather than zero or partial bucket counts',()=>{
 for(const value of [undefined,null,' ',false,true,[],{},NaN,Infinity,-Infinity,-1,3.5,'bad'])assert.equal(ageingValue(t('KL','CAMC',value)),null);
 for(const value of [0,'0',' 0 ',3,'91'])assert.equal(ageingValue(t('KL','CAMC',value)),Number(value));
 const summary=buildAgeingReports([t('KL','CAMC',null),t('KL','CAMC',0)]).stages.at(-1);
 assert.equal(summary.average,0);assert.equal(summary.oldest,0);assert.equal(summary.bands.Unknown,1);
});

test('all 17 stages and every region reconcile by individual tickets and preserve completed calls still in dump',()=>{
 assert.equal(RETAIL_FAULT_STAGES.length,17);
 const ages=[0,3,4,7,8,15,16,30,31,60,61,90,91,null];
 const tickets=AGEING_REGIONS.flatMap(([region],r)=>RETAIL_FAULT_STAGES.map((stage,i)=>({...t(region,stage,ages[(i+r)%ages.length]),id:region+i})));
 tickets.push({...t('PY','HK',0),id:'PY'}, {...t('XX','Legacy source stage',null),id:'unknown'});
 const before=JSON.stringify(tickets);
 for(const selection of ['',...AGEING_REGIONS.map(([code])=>code)]){
  const report=buildAgeingReports(tickets,selection),expected=tickets.filter(ticket=>!selection||ageingRegion(ticket)===selection);
  assert.equal(report.stages.at(-1).total,expected.length);
  assert.equal(report.stages.slice(0,-1).reduce((sum,row)=>sum+row.total,0),expected.length);
  const known=expected.filter(ticket=>ticket.ageingDays!==null).map(ticket=>ticket.ageingDays);
  assert.equal(report.stages.at(-1).average,known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length*10)/10:null);
  for(const stage of RETAIL_FAULT_STAGES)assert.equal(report.stages.find(row=>row.label===stage).total,expected.filter(ticket=>ticket.ifmsStage===stage).length);
  assert.equal(report.states.at(-1).total,tickets.length);
  assert.equal(report.states.slice(0,-1).reduce((sum,row)=>sum+row.total,0),tickets.length);
  for(const row of [...report.stages,...report.states])assert.equal(AGEING_COLUMNS.reduce((sum,band)=>sum+row.bands[band],0),row.total);
 }
 assert.equal(buildAgeingReports(tickets,'TN').stages.find(row=>row.label==='HK').total,2,'PY joins TN');
 const completed='Work Completed - Call Yet to Close';
 assert.equal(buildAgeingReports(tickets).stages.find(row=>row.label===completed).total,6);
 assert.equal(buildAgeingReports(tickets.filter(ticket=>ticket.ifmsStage!==completed)).stages.find(row=>row.label===completed).total,0,'only disappearance from current data removes a completed call');
 assert.equal(JSON.stringify(tickets),before);
});

test('drill-down identities, compact bands and Unknown counts match each displayed cell',()=>{
 const tickets=[0,3,4,7,8,15,16,30,31,60,61,90,91,null].map((age,i)=>({...t(i%2?'PY':'KL','CAMC',age),id:'ticket-'+i}));
 const {stages,states}=buildAgeingReports(tickets);
 for(const row of [...stages,...states]){
  assert.equal(ageingDetailTickets(row,null).length,row.total);
  for(const band of AGEING_COLUMNS){
   const details=ageingDetailTickets(row,[band]);
   assert.equal(details.length,row.bands[band]);assert.ok(details.every(ticket=>ageingBand(ticket)===band));
  }
  assert.equal(ageingDetailTickets(row,AGEING_COLUMNS.slice(0,4)).length,AGEING_COLUMNS.slice(0,4).reduce((n,key)=>n+row.bands[key],0));
 }
 assert.deepEqual(ageingDetailTickets(null,null),[]);
});

test('Excel round-trip matches displayed numeric totals, both requested sheet names and exact detail values',()=>{
 const tickets=[{...t('KL','HK',91),ticketNumber:'KL-RETAINED',storeId:'0012',storeName:'Kerala Store',issueTitle:'Retained issue',remarks:''},t('PY','CAMC',0),t('KN','OEM',null)];
 const {stages,states}=buildAgeingReports(tickets,'KL');
 const workbook=XLSX.utils.book_new();
 for(const [i,rows] of [stages,states].entries())XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(ageingExportRows(rows,i===1)),AGEING_SHEET_NAMES[i]);
 const decoded=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 assert.deepEqual(decoded.SheetNames,AGEING_SHEET_NAMES);
 for(const [i,rows] of [stages,states].entries()){
  const actual=XLSX.utils.sheet_to_json(decoded.Sheets[AGEING_SHEET_NAMES[i]],{header:1,defval:null});
  assert.deepEqual(actual,ageingExportRows(rows,i===1));
 }
 const details=ageingTicketExportRows([tickets[0],{...tickets[0],ageingSourceDays:null}]);
 assert.deepEqual(details[0],['Ticket Number','Store Code','Store Name','State','Issue Description','IFMS Stage','Ageing Days','Remarks']);
 assert.deepEqual(details[1],['KL-RETAINED','0012','Kerala Store','KL','Retained issue','HK',91,'']);
 assert.equal(details[2][6],'Unknown');
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
