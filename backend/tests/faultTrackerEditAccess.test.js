import test from 'node:test';
import assert from 'node:assert/strict';
import {canEditFaultTracker,requireFaultTrackerEditor} from '../services/faultTrackerEditAccess.js';
import {isInitialRetailAdmin} from '../services/retailInitialAdminAccess.js';
import {RETAIL_MIS_ONBOARDING_ADMINS} from '../shared/retailMisAccess.js';
const profile=a=>({id:a.profile_id,auth_user_id:a.auth_user_id,employee_code:a.employee_code,role:'Admin',status:'Active',is_active:true,web_access_enabled:true});
test('Fault Tracker grant covers three exact accounts only and leaves other operational gates unchanged',()=>{
 for(const a of RETAIL_MIS_ONBOARDING_ADMINS){
  const p=profile(a),auth={id:p.auth_user_id};
  assert.equal(canEditFaultTracker(p,auth),['QPMSADMIN','QPMSAP25191','QPMSTNC17010'].includes(p.employee_code));
  assert.equal(isInitialRetailAdmin(p,auth),p.employee_code==='QPMSADMIN');
 }
 assert.equal(canEditFaultTracker({role:'Admin',is_active:true,web_access_enabled:true}),false);
});
test('Delegated editors cannot edit under mismatched or disabled identities',()=>{
 for(const a of RETAIL_MIS_ONBOARDING_ADMINS.filter(a=>['QPMSAP25191','QPMSTNC17010'].includes(a.employee_code))){
  const p=profile(a),auth={id:p.auth_user_id};
  for(const overrides of [{id:'wrong'},{employee_code:'wrong'},{auth_user_id:'wrong'},{role:'MIS_MEPC'},{status:'Inactive'},{is_active:false},{web_access_enabled:false}]){
   assert.equal(canEditFaultTracker({...p,...overrides},auth),false);
  }
  assert.equal(canEditFaultTracker(p,{id:'wrong'}),false);
  let passed=false;
  requireFaultTrackerEditor({profile:p,authUser:auth},{status(){throw Error('unexpected denial');}},()=>{passed=true;});
  assert.equal(passed,true);
 }
});
test('Unauthorized requests fail before the ticket handler',()=>{
 for(const req of [{},{profile:{id:'unknown',role:'Admin'},authUser:{id:'unknown'}}]){
  let status;
  requireFaultTrackerEditor(req,{status(s){status=s;return this;},json(){}},()=>{throw Error('unexpected grant');});
  assert.equal(status,req.authUser?403:401);
 }
});
