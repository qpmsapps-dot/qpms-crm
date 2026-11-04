import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './foOctoberAdminClaims.test.js';
import {octoberPaymentClaimData,paymentFingerprint,REPORT_CONFIRMATION_PREFIX} from '../services/foOctoberPaymentClaimsService.js';
const row=data=>data.groups.flatMap(g=>g.rows)[0];
function confirmed(f){
 const a=f.db.fo_attendance[0];a.eligible_km=531.69;a.petrol_amount=1690.76;
 const confirmation={kind:'branch_head_approved_super_admin_confirmed_pending_audit',financial_posting_authorized:false,requested_hundredths:15000,attendance_fingerprint:paymentFingerprint([a]),branch_head_identity:null,approval_reference:null,approval_date:null};
 f.db.fo_oct2026_claim_adjustments.push({employee_code:a.employee_code,claim_month:'2026-10-01',adjustment_type:'ADD_KM',requested_km:150,status:'PROVISIONAL',reason:REPORT_CONFIRMATION_PREFIX+JSON.stringify(confirmation)});
 return f;
}
const expense=(id,extra={})=>({id,attendance_id:'00000000-0000-4000-8000-000000000001',employee_code:'FO000',status:'approved',reviewed_at:'2026-11-04T00:00:00Z',reviewed_by_auth_user_id:'synthetic-reviewer',fare_amount:25,claim_type:'transport',travel_mode:'auto',...extra});
test('confirmed existing ADD_KM is report-only, preserves petrol and rejects changed financial evidence',async()=>{
 const f=confirmed(fixture(1)),before=JSON.stringify(f.db);const r=row(await octoberPaymentClaimData(f.client));
 assert.equal(r.reportKm,68169);assert.equal(r.original,53169);assert.equal(r.petrol,169076);assert.equal(r.total,169076);assert.equal(r.reportOnlyKm,15000);
 assert.equal(JSON.stringify(f.db),before);assert.equal(f.writes.length,0);
 f.db.fo_attendance[0].eligible_km=681.69;await assert.rejects(()=>octoberPaymentClaimData(f.client),/stale or invalid/);
});
test('unconfirmed provisional requests are excluded and zero final KM employees are removed',async()=>{
 const f=fixture(2);f.db.fo_attendance[0].eligible_km=0;
 f.db.fo_oct2026_claim_adjustments.push({employee_code:'FO000',claim_month:'2026-10-01',adjustment_type:'ADD_KM',requested_km:150,status:'PROVISIONAL'});
 const d=await octoberPaymentClaimData(f.client);assert.equal(d.totals.employees,1);assert.equal(row(d).employee_code,'FO001');assert.equal(d.totals.reportOnlyKm,0);
});
test('approved fares and parking count once; submitted, rejected and unaudited claims do not become payable',async()=>{
 const f=fixture(1);f.db.fo_travel_expense_claims=[expense('auto'),expense('bus',{travel_mode:'bus',fare_amount:70,travel_leg_id:'leg-bus'}),expense('parking',{claim_type:'parking',travel_mode:'other',fare_amount:10}),expense('ticket',{claim_type:'ticket',travel_mode:'other',fare_amount:15}),expense('pending',{status:'submitted',fare_amount:999}),expense('rejected',{status:'rejected'}),expense('unaudited',{reviewed_by_auth_user_id:null})];
 const r=row(await octoberPaymentClaimData(f.client));assert.equal(r.other,2500);assert.equal(r.parkingTicket,9500);assert.equal(r.total,13000);assert.equal(r.pendingExpenses,2);
 assert.ok(!f.reads.includes('fo_travel_legs'));assert.equal(f.writes.length,0);
});
test('claim identity, linked fare and proof duplicates fail closed; employee linkage is verified',async()=>{
 for(const pair of [[expense('same'),expense('same')],[expense('a',{travel_leg_id:'leg'}),expense('b',{travel_leg_id:'leg'})],[expense('a',{proof_file_url:'proof?token=1'}),expense('b',{proof_file_url:'proof?token=2'})]]){
  const f=fixture(1);f.db.fo_travel_expense_claims=pair;await assert.rejects(()=>octoberPaymentClaimData(f.client),/uplicate/);
 }
 const f=fixture(2);f.db.fo_travel_expense_claims=[expense('wrong',{employee_code:'FO001'})];await assert.rejects(()=>octoberPaymentClaimData(f.client),/employee mismatch/);
});
test('missing approval evidence remains distinguishable from an approved zero',async()=>{
 const f=fixture(1);let r=row(await octoberPaymentClaimData(f.client));assert.equal(r.otherVerified,0);assert.equal(r.parkingTicketVerified,0);
 f.db.fo_travel_expense_claims=[expense('zero',{fare_amount:0})];r=row(await octoberPaymentClaimData(f.client));assert.equal(r.other,0);assert.equal(r.otherVerified,1);
});
test('invalid approved expense amounts and unknown types fail rather than creating a partial report',async()=>{
 for(const change of [{fare_amount:-1},{fare_amount:1.001},{claim_type:'unknown'},{travel_mode:'bike'}]){const f=fixture(1);f.db.fo_travel_expense_claims=[expense('invalid',change)];await assert.rejects(()=>octoberPaymentClaimData(f.client));}
});

import {PDFParse} from 'pdf-parse';
import {renderOctoberClaimsPdf} from '../routes/foOctoberClaimsExportRoutes.js';
test('seven-column pagination has no blank pages and repeats headers and group totals',async()=>{
 const f=confirmed(fixture(1)),data=await octoberPaymentClaimData(f.client),template=row(data);data.groups=[{name:'TN / Reliance Retail',rows:Array.from({length:30},(_,i)=>({...template,employee_code:'SYNTH'+i,reportOnlyKm:i===0?15000:0}))}];
 const doc=renderOctoberClaimsPdf(data),chunks=[];doc.on('data',c=>chunks.push(c));const done=new Promise((r,j)=>{doc.on('end',r);doc.on('error',j)});doc.end();await done;
 const parser=new PDFParse({data:new Uint8Array(Buffer.concat(chunks))});try{const output=await parser.getText();assert.equal(output.total,3);assert.equal((output.text.match(/Employee Code/g)||[]).length,3);assert.equal((output.text.match(/GROUP TOTAL/g)||[]).length,1);assert.match(output.text,/pending formal audit verification/);assert.match(output.text,/Page 3 of 3/);assert.doesNotMatch(output.text,/Proposed KM|Difference KM|Adjustment status|Original review cases/);}finally{await parser.destroy()}
});
