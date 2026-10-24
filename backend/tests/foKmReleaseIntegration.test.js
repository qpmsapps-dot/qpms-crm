import { assertManualKmRangeAllowed } from '../services/foManualKmRefreshService.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { reconcileFinalLegOnly } from '../foKmRecalculationService.js';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';
import { createEmployeeRangeRecalculationRegistry } from '../services/foEmployeeRangeRecalculationLockService.js';
import { recalculateEmployeeRange } from '../services/employeeRangeReportService.js';
import { kmFinancialWritesMaintenanceEnabled } from '../services/kmFinancialWriteMaintenanceService.js';

// All evidence is synthetic and all persistence is stubbed. Fail on any network.
const oldFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = () => { throw new Error('Network is forbidden in release integration tests'); }; });
test.after(() => { globalThis.fetch = oldFetch; });
const source = readFileSync(new URL('./foKmAuthorizedActions.test.js', import.meta.url), 'utf8');
const fixture = vm.runInNewContext(source.slice(source.indexOf('function fixture()'), source.indexOf('\ntest(')) + '\nfixture;', { assert, Date, structuredClone });
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const admin = { employee_code: 'SQLADMIN', role: 'Admin', is_active: true, status: 'active', web_access_enabled: true };

function forwardFixture() {
  const f = fixture();
  for (const rows of Object.values(f.rows)) for (const row of rows) for (const [key,value] of Object.entries(row)) {
    if (typeof value === 'string') row[key] = value.replaceAll('2026-10-10', '2026-10-16');
  }
  f.attendance.route_sync_status = 'pending_canonical_end_day_recalculation';
  return f;
}

test('recovered final-leg service reaches only the existing 216 RPC and preserves its expected-version contract', async () => {
  const { client, attendance, rows } = forwardFixture();
  const before = structuredClone(rows);
  const calls = [];
  client.rpc = async (name,args) => {
    calls.push({name,args});
    assert.equal(name,'rpc_persist_fo_forward_final_leg_v1');
    assert.equal(args.p_attendance_id,attendance.id);
    assert.equal(args.p_expected_attendance_updated_at,attendance.updated_at);
    assert.equal(args.p_source_entry_point,'web_refresh_km');
    assert.equal(args.p_calculation.before.totalRouteKm,999);
    assert.match(args.p_input_digest,/^[a-f0-9]{64}$/);
    assert.equal(args.p_calculation.finalLeg.source,'GPS_BASED');
    assert.ok(args.p_calculation.sourceRowIds.length >= 10);
    return { data: { ok:true,total_route_km:999.2,total_approved_km:999.2,reimbursement:3996.8,calculation_run_id:'11111111-1111-4111-8111-111111111111',route_sync_status:'canonical_v2_persisted' }, error:null };
  };
  const result = await reconcileFinalLegOnly(client,{attendance_id:attendance.id},{persist:true,maxGoogleDirectionsCalls:0,enforceEndDayGpsSyncGrace:false,sourceEntryPoint:'web_refresh_km'});
  assert.equal(result.updated,true);
  assert.equal(result.route_sync_status,'canonical_v2_persisted');
  assert.equal(calls.length,1);
  assert.equal(JSON.stringify(rows),JSON.stringify(before));
});

test('forward service propagates database stale-input rejection without nontransactional writes', async () => {
  const { client, attendance, rows } = forwardFixture();
  const before=structuredClone(rows);
  client.rpc=async()=>({error:{code:'40001',message:'forward_final_leg_stale_input'}});
  await assert.rejects(reconcileFinalLegOnly(client,{attendance_id:attendance.id},{persist:true,maxGoogleDirectionsCalls:0,enforceEndDayGpsSyncGrace:false}),e=>e.statusCode===409&&e.code==='forward_final_leg_stale_input');
  assert.equal(JSON.stringify(rows),JSON.stringify(before));
});

test('forward historical cutoff skips persistence before evidence loading', async () => {
  const {client,attendance}=fixture();
  client.from=(table)=>{assert.equal(table,'fo_attendance');return {select(){return this;},eq(){return this;},single:async()=>({data:attendance,error:null})};};
  client.rpc=()=>{throw new Error('Historical persistence forbidden');};
  const result=await reconcileFinalLegOnly(client,{attendance_id:attendance.id},{persist:true,maxGoogleDirectionsCalls:0});
  assert.equal(result.skip_reason,'FORWARD_FINAL_LEG_BEFORE_EFFECTIVE_DATE');
  assert.equal(result.updated,false);
});

function routeHarness({days,canonical,forward,maintenance='true'}={}) {
  let handler;
  const context={
    app:{post(...args){handler=args.at(-1);}},
    requireSupabaseJwt(){},requireFoKmBatchRecalculationPermission(){},
    adminKmApprovalAuthorization,kmFinancialWritesMaintenanceEnabled,assertManualKmRangeAllowed,
    process:{env:{KM_FINANCIAL_WRITES_MAINTENANCE:maintenance}},
    endDayKmAutoRecalcEffectiveFrom:()=> '2026-10-16',endDayKmAutoRecalcGraceMinutes:()=>5,
    FO_KM_RECALCULATION_MAINTENANCE_MESSAGE:'maintenance',FO_KM_RECALCULATION_RUNNING_MESSAGE:'running',
    foEmployeeRangeRecalculationOperations:createEmployeeRangeRecalculationRegistry(),
    requireServiceRoleSupabase:()=>({}),assertServiceRoleAuthAdminAccess:async()=>{},
    loadAuthorizedEmployeeRange:async()=>({attendance_days:days,employee:{employee_code:'SQLFO'}}),
    recalculateEmployeeRange,recalculateFoKm:canonical,reconcileFinalLegOnly:forward,
    safeServiceRoleError:e=>({statusCode:e.statusCode||500,message:e.message}),
  };
  const start=server.indexOf("app.post('/api/fo/km/recalculate-employee-range'");
  const end=server.indexOf('\napp.',start+1);
  vm.runInNewContext(server.slice(start,end),context);
  return async (body={},profile=admin)=>{
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    await handler({body,profile,authUser:{id:'verified-jwt-admin'}},res);return res;
  };
}
const day=(date='2026-10-21',id='day')=>({id,employee_code:'SQLFO',attendance_date:date,logout_time:date+'T13:00:00Z'});

test('actual range route sends explicit Admin reason and verified JWT identity through full canonical correction',async()=>{
  const calls=[];
  const run=routeHarness({maintenance:'false',days:[day('2026-10-10')],canonical:async(...args)=>{calls.push(args);return {ok:true,updated:true};},forward:()=>{throw Error('Unexpected forward call');}});
  const result=await run({date_from:'2026-10-10',date_to:'2026-10-10',approval_reason:'Verified correction',p_admin_user_id:'spoofed'});
  assert.equal(result.statusCode,200);assert.equal(calls.length,1);
  assert.equal(calls[0][2].adminAuthorization.userId,'verified-jwt-admin');
  assert.equal(calls[0][2].adminAuthorization.reason,'Verified correction');
  assert.equal(calls[0][2].refreshMissingKmReviews,false);
});

test('actual no-reason range route requires the reviewed manual workflow during maintenance',async()=>{
  let calls=0;
  const run=routeHarness({days:[day()],canonical:()=>{throw Error('Unexpected full recalculation');},forward:async(client,payload,options)=>{calls++;assert.equal(options.persist,true);assert.equal(options.sourceEntryPoint,'web_refresh_km');return {ok:true,updated:true};}});
  const result=await run({date_from:'2026-10-21',date_to:'2026-10-21'});
  assert.equal(result.statusCode,423);assert.equal(calls,0);
});

test('actual range route preserves historical hold and rejects non-Admin correction before loading attendance',async()=>{
  const run=routeHarness({days:[day('2026-10-10')],canonical:()=>{throw Error('Persistence forbidden');},forward:()=>{throw Error('Persistence forbidden');}});
  assert.equal((await run({date_from:'2026-10-10',date_to:'2026-10-10'})).statusCode,423);
  assert.equal((await run({approval_reason:'reason'},{...admin,role:'FO'})).statusCode,423);
});

test('actual range handler returns 503/422 for all failures and 207 for partial success',async()=>{
  for(const [failStatus,partial,expected] of [[503,false,503],[409,false,422],[503,true,207]]){
    let n=0;
    const run=routeHarness({maintenance:'false',days:[day('2026-10-21','one'),day('2026-10-21','two')],forward:async()=>{if(partial&&n++===0)return {ok:true,updated:true};throw Object.assign(Error('synthetic failure'),{statusCode:failStatus,retryable:true});}});
    const result=await run({date_to:'2026-10-21'});
    assert.equal(result.statusCode,expected);assert.equal(result.body.ok,false);
    assert.equal(result.body.failed,partial?1:2);
  }
});

test('release keeps the read-only-UAT worker guard and exact migration RPC interfaces',()=>{
  assert.ok(server.includes('startAutomaticBackgroundWorkers({'));
  const worker=server.slice(server.indexOf('startAutomaticBackgroundWorkers({'));
  assert.ok(worker.includes('startFoGpsEvidenceSummaryWorker(serviceRoleSupabase, process.env)'));
  const sql228=readFileSync(new URL('../../supabase/migrations_2_0/228_fo_atomic_admin_km_approval.sql',import.meta.url),'utf8');
  assert.match(sql228,/p_admin_user_id uuid, p_approval_reason text, p_review_decision jsonb default null/);
  const sql229=readFileSync(new URL('../../supabase/migrations_2_0/229_fo_coalesced_gps_evidence_summary.sql',import.meta.url),'utf8');
  assert.match(sql229,/rpc_refresh_fo_gps_evidence_summaries_v1\(p_limit integer default 5\)/);
});
