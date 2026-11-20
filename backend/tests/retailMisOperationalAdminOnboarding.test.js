import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetailMisOnboardingAdmin,RETAIL_MIS_ONBOARDING_ADMINS} from '../shared/retailMisAccess.js';
import {isInitialRetailAdmin} from '../services/retailInitialAdminAccess.js';

function profile(identity,overrides={}){
 return {id:identity.profile_id,auth_user_id:identity.auth_user_id,employee_code:identity.employee_code,role:'Admin',is_active:true,status:'Active',web_access_enabled:true,...overrides};
}

test('four exact existing Admin identities can onboard Retail MIS accounts',()=>{
 assert.equal(RETAIL_MIS_ONBOARDING_ADMINS.length,4);
 for(const identity of RETAIL_MIS_ONBOARDING_ADMINS){
  assert.equal(isRetailMisOnboardingAdmin(profile(identity),{id:identity.auth_user_id}),true,identity.employee_code);
 }
});

test('onboarding grant is not a general Admin or developer alias',()=>{
 for(const identity of RETAIL_MIS_ONBOARDING_ADMINS){
  const good=profile(identity),auth={id:identity.auth_user_id};
  for(const changed of [
   {employee_code:'OTHER'}, {auth_user_id:'00000000-0000-0000-0000-000000000000'},
   {id:'00000000-0000-0000-0000-000000000000'},
   {role:'Developer'},{role:'MIS_MEPC'},{is_active:false},{status:'Inactive'},{web_access_enabled:false},
  ]){
   assert.equal(isRetailMisOnboardingAdmin({...good,...changed},auth),false,identity.employee_code+' '+Object.keys(changed));
  }
  assert.equal(isRetailMisOnboardingAdmin(good,{id:'00000000-0000-0000-0000-000000000000'}),false);
 }
 assert.equal(isRetailMisOnboardingAdmin(profile(RETAIL_MIS_ONBOARDING_ADMINS[0]),null),false);
});

test('legacy initial-only Retail write gate remains exclusive to QPMSADMIN',()=>{
 for(const identity of RETAIL_MIS_ONBOARDING_ADMINS){
  assert.equal(isInitialRetailAdmin(profile(identity),{id:identity.auth_user_id}),identity.employee_code==='QPMSADMIN');
 }
});
