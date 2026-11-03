import test from 'node:test';import assert from 'node:assert/strict';
import {prepareRetailMisUser,saveRetailMisUser} from '../services/retailMisUserManagement.js';
import {canonicalProfileRoleForWrite} from '../userManagementService.js';
import {RETAIL_MIS_ROLES,RETAIL_MIS_ASSIGNABLE_ROLES,RETAIL_OOS_STATES} from '../shared/retailMisAccess.js';
const profile={id:'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',auth_user_id:'79cd196c-c6f3-404a-b22a-d4683afefa3f',employee_code:'QPMSADMIN',role:'Admin',is_active:true,status:'Active'};
const request={profile,authUser:{id:profile.auth_user_id}};
test('three official MIS labels preserve canonical profile identifiers and six assignable states',()=>{
 assert.deepEqual(RETAIL_MIS_ASSIGNABLE_ROLES.map(r=>RETAIL_MIS_ROLES[r]),['HK-MIS','MEPC-MIS','OOS-MIS']);assert.deepEqual(RETAIL_OOS_STATES,['TN','KA','KL','TG','AP-1','AP-2']);
 for(const role of RETAIL_MIS_ASSIGNABLE_ROLES){assert.equal(canonicalProfileRoleForWrite(role),role);assert.equal(canonicalProfileRoleForWrite(RETAIL_MIS_ROLES[role]),role);}
});
test('MIS user provisioning requires exact server-verified Super Admin, revision, audit reason and explicit scope',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{version:1}};}};
 const body={role:'MIS_OOS',retail_mis_states:['TN','KA'],retail_mis_revision:0,retail_mis_reason:'Approved isolated test assignment'};
 for(const role of RETAIL_MIS_ASSIGNABLE_ROLES){const plan=await prepareRetailMisUser(client,request,{...body,role});assert.equal(plan.role,role);assert.deepEqual(plan.states,['KA','TN']);}
 await assert.rejects(prepareRetailMisUser(client,{...request,authUser:{id:'forged'}},body),/Super Admin/);
 await assert.rejects(prepareRetailMisUser(client,{profile},body),/Super Admin/);
 await assert.rejects(prepareRetailMisUser(client,{...request,authUser:{id:'forged'}},{...body,role:'OOS-MIS'}),/Super Admin/);
 await assert.rejects(prepareRetailMisUser(client,request,{...body,retail_mis_states:['PY']}),/separate PY/);
 await assert.rejects(prepareRetailMisUser(client,request,{...body,retail_mis_states:['AP']}),/ambiguous/);
 await assert.rejects(prepareRetailMisUser(client,request,{...body,retail_mis_reason:''}),/audit/);
 await assert.rejects(prepareRetailMisUser(client,request,{...body,hospital_access:{enabled:true}}),/unrelated/);
 await assert.rejects(prepareRetailMisUser(client,request,{...body,role:'Admin'},{role:'MIS_OOS'}),/revocation/);
 assert.equal(await prepareRetailMisUser(client,{}, {role:'FO'}),null);
 const plan=await prepareRetailMisUser(client,request,body);await saveRetailMisUser(client,request,{id:'target',auth_user_id:'target-auth',employee_code:'LOCAL'},plan,{full_name:'Edited'});
 const saved=calls.at(-1);assert.equal(saved.name,'rpc_retail_mis_user_save');assert.equal(saved.args.p_actor,profile.id);assert.equal(saved.args.p_auth,'target-auth');assert.deepEqual(saved.args.p_patch,{full_name:'Edited'});
});
