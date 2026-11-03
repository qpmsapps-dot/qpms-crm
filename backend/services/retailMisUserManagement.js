import {canonicalProfileRole} from '../userManagementService.js';
import {retailMisRole,retailMisScopeStates,RETAIL_MIS_ASSIGNABLE_ROLES} from '../shared/retailMisAccess.js';
import {isInitialRetailAdmin} from './retailInitialAdminAccess.js';
import {misRpc} from './retailMisService.js';
export async function prepareRetailMisUser(client,request,body,oldProfile=null){
 const role=canonicalProfileRole(body.role||oldProfile?.role);
 if(!retailMisRole(role)&&!retailMisRole(oldProfile?.role))return null;
 if(!request.authUser?.id||!isInitialRetailAdmin(request.profile,request.authUser))throw Object.assign(Error('Exact Super Admin required for MIS user management.'),{statusCode:403});
 if(!RETAIL_MIS_ASSIGNABLE_ROLES.includes(role))throw Object.assign(Error('Use audited Retail assignment revocation before changing to a non-MIS role.'),{statusCode:400});
 const states=retailMisScopeStates(body.retail_mis_states);
 if(body.retail_mis_states.some(s=>s==='PY'))throw Object.assign(Error('Select TN including PY; no separate PY grant.'),{statusCode:400});
 if(!Number.isInteger(body.retail_mis_revision)||body.retail_mis_revision<0||String(body.retail_mis_reason||'').trim().length<3)throw Object.assign(Error('Assignment revision and audit reason required.'),{statusCode:400});
 if(body.create_profile_only||body.hospital_access_enabled||body.hospital_access||body.client_id||body.access_assignment?.module_id)throw Object.assign(Error('MIS users cannot receive unrelated module access in this operation.'),{statusCode:400});
 await misRpc(client,'rpc_retail_mis_user_contract',{p_actor:request.profile.id});
 return {role,states,reason:body.retail_mis_reason,revision:body.retail_mis_revision};
}
export async function saveRetailMisUser(client,request,profile,plan,patch={}){
 return misRpc(client,'rpc_retail_mis_user_save',{p_actor:request.profile.id,p_target:profile.id,p_auth:profile.auth_user_id,p_employee:profile.employee_code,p_role:plan.role,p_states:plan.states,p_reason:plan.reason,p_expected:plan.revision,p_patch:patch});
}
