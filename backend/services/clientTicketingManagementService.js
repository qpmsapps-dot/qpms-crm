const adminRoles = new Set(['ADMIN','QPMSADMIN','DEVELOPER','DEV']);
const resources = new Set(['client','block','floor','location','category','staff','contact']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function managementError(statusCode,message){return Object.assign(new Error(message),{statusCode});}
export function requireClientManagement(profile){
  if(!profile || profile.is_active !== true || profile.status&&String(profile.status).toUpperCase()!=='ACTIVE' || !adminRoles.has(String(profile.role||'').toUpperCase().replace(/[^A-Z0-9]/g,'')))throw managementError(403,'Administrator access required.');
}
async function data(query){const result=await query;if(result.error)throw result.error;return result.data;}
export function validateDraftInput(resource,input={}){
  if(!resources.has(resource))throw managementError(400,'Unknown configuration resource.');
  const allowed={client:['id','code','name','business_vertical_id'],block:['id','code','name'],floor:['id','code','name','block_id'],location:['id','code','name','block_id','floor_id','floor_name','location_type'],category:['id','code','name','priority','supervisor_sla_minutes','operations_sla_minutes'],staff:['id','employee_code','role_code','scope_type','block_id','location_id','scope_mode'],contact:['id','full_name','mobile','email','designation','department']}[resource];
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw managementError(400,'Only draft configuration fields are allowed; activation is unavailable.');
  const result={};for(const [k,v]of Object.entries(input)){
    if(v===null||v===''){result[k]=null;continue;}
    if(k==='id'||k.endsWith('_id')){if(typeof v!=='string'||!uuid.test(v))throw managementError(400,`Invalid ${k}.`);result[k]=v;}
    else if(k.endsWith('_minutes')){if(!Number.isInteger(Number(v))||Number(v)<1||Number(v)>1440)throw managementError(400,'SLA minutes must be from 1 to 1440.');result[k]=Number(v);}
    else{if(typeof v!=='string'||v.length>300)throw managementError(400,`Invalid ${k}.`);result[k]=v.trim();}
  }
  const required={client:['code','name','business_vertical_id'],block:['code','name'],floor:['code','name','block_id'],location:['code','name','block_id'],category:['code','name','priority'],staff:['employee_code','role_code','scope_type'],contact:['full_name','mobile']}[resource];
  if(required.some(k=>!result[k]))throw managementError(400,'Complete all required fields.');
  if(result.role_code&&!['housekeeping_supervisor','operations_executive','facility_manager'].includes(result.role_code))throw managementError(400,'Unsupported staff role.');
  if(result.scope_type&&!['client','block','location'].includes(result.scope_type))throw managementError(400,'Unsupported location scope.');
  if(result.scope_mode&&!['add','replace'].includes(result.scope_mode))throw managementError(400,'Unsupported scope save mode.');
  if(result.scope_type==='block'&&!result.block_id||result.scope_type==='location'&&!result.location_id)throw managementError(400,'Select the scope location.');
  if(resource==='category'&&!['low','medium','high','critical'].includes(result.priority))throw managementError(400,'Invalid priority.');
  if(resource==='category'&&(result.code.toUpperCase()!=='HOUSEKEEPING'||result.name.toLowerCase()!=='housekeeping'))throw managementError(400,'Only the verified Housekeeping category is supported for Residential onboarding.');
  if(resource==='category'&&(!result.supervisor_sla_minutes||!result.operations_sla_minutes))throw managementError(400,'Specify both SLA values for review.');
  if(resource==='location'&&(!['unit','common_area','facility','other'].includes(result.location_type)||!result.floor_id&&!result.floor_name))throw managementError(400,'Specify location type and floor or explicit source floor label.');
  if(resource==='contact'){let mobile=result.mobile.replace(/\D/g,'');if(mobile.length===12&&mobile.startsWith('91'))mobile=mobile.slice(2);if(!/^[6-9]\d{9}$/.test(mobile))throw managementError(400,'A valid registered mobile is required.');result.mobile=mobile;if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw managementError(400,'Invalid email.');}
  return result;
}
export async function listManagementClients(client,profile){requireClientManagement(profile);const [verticals,clients]=await Promise.all([
  data(client.from('access_business_verticals').select('id,code,name,active').order('name')),
  data(client.from('hospital_clients').select('id,client_code,client_name,business_type,is_active,metadata').order('client_name'))]);
  return{verticals:verticals.filter(v=>['residential','apartment','apartment_residential'].includes(v.code.toLowerCase())),clients:clients.map(c=>({...c,editable:c.business_type==='residential'&&!c.is_active&&c.metadata?.ticketing_rollout?.state==='draft'}))};
}
export async function loadManagementDraft(client,profile,clientId){
  requireClientManagement(profile);if(!uuid.test(clientId))throw managementError(400,'Invalid client.');
  const draft=await data(client.from('hospital_clients').select('id,client_code,client_name,business_type,is_active,metadata').eq('id',clientId).maybeSingle());
  if(!draft||draft.business_type!=='residential'||draft.is_active||draft.metadata?.ticketing_rollout?.state!=='draft')throw managementError(403,'Only inactive Residential drafts can be configured here. Hospital records are read-only.');
  const access=await data(client.from('access_clients').select('id,business_vertical_id').eq('metadata->>legacy_hospital_client_id',clientId).eq('active',false).maybeSingle());
  if(!access)throw managementError(409,'Draft business/client mapping requires review.');
  const tables={blocks:'hospital_blocks',floors:'hospital_floors',locations:'hospital_locations',categories:'hospital_ticket_categories',staff:'hospital_ticket_users',contacts:'hospital_client_contacts'};
  const selects={blocks:'id,block_code,block_name,is_active',floors:'id,block_id,floor_code,floor_name,is_active',locations:'id,block_id,floor_id,location_code,location_name,floor_name,is_active,metadata',categories:'id,category_code,category_name,default_priority,supervisor_sla_minutes,operations_sla_minutes,is_active',staff:'id,employee_code,display_name,role_code,is_active',contacts:'id,full_name,mobile,email,designation,department,is_active'};
  const rows=await Promise.all(Object.entries(tables).map(async([key,table])=>[key,await data(client.from(table).select(selects[key]).eq('client_id',clientId).order('id').limit(1001))]));
  if(rows.some(([,values])=>values.length>1000))throw managementError(413,'Draft exceeds the configuration limit; narrow management tooling is required.');
  const staffIds=rows.find(([key])=>key==='staff')[1].map(r=>r.id);
  const scopes=staffIds.length?await data(client.from('hospital_ticket_user_scopes').select('hospital_ticket_user_id,scope_type,block_id,location_id,can_view,can_update').eq('client_id',clientId).in('hospital_ticket_user_id',staffIds).eq('can_view',true)):[];
  const configuration={client:{...draft,business_vertical_id:access.business_vertical_id},...Object.fromEntries(rows),scopes};
  return{...configuration,readiness:draftConfigurationReadiness(configuration)};
}
export function draftConfigurationReadiness(draft){
  const rows=key=>draft[key]||[];
  const roleUsers=role=>rows('staff').filter(u=>u.role_code===role);
  const checks=[
    ['blocks','Towers / blocks configured',rows('blocks').length>0],
    ['floors','Floors configured',rows('floors').length>0],
    ['locations','Locations configured',rows('locations').length>0],
    ['housekeeping','Housekeeping category configured',rows('categories').some(c=>c.category_code?.toUpperCase()==='HOUSEKEEPING')],
    ['supervisor','Supervisor mapped',roleUsers('housekeeping_supervisor').length>0],
    ['executive','Operations Executive mapped',roleUsers('operations_executive').length>0],
    ['fm','Facility Manager mapped',roleUsers('facility_manager').length>0],
    ['contacts','Management Client Person configured',rows('contacts').length>0]
  ].map(([code,label,configured])=>({code,label,configured}));
  const supervisors=new Set(roleUsers('housekeeping_supervisor').map(u=>u.id));
  const coverage=rows('blocks').map(block=>({block_id:block.id,name:block.block_name,
    configured:rows('scopes').some(s=>supervisors.has(s.hospital_ticket_user_id)&&s.can_view&&s.can_update&&(
      s.scope_type==='client'||s.scope_type==='block'&&s.block_id===block.id))}));
  return{state:'draft_only',checks,block_coverage:coverage,
    location_scope_count:rows('scopes').filter(s=>supervisors.has(s.hospital_ticket_user_id)&&s.scope_type==='location'&&s.can_view&&s.can_update).length,
    unsupported_categories:rows('categories').filter(c=>c.category_code?.toUpperCase()!=='HOUSEKEEPING').length,
    activation_ready:false,
    pending_verification:['Draft mappings do not prove live routing or shift/on-duty coverage.','Location-specific scopes cover only their selected locations, not the whole tower.','Client Person permissions, security acceptance and release validation require separate approval.']};
}
export async function saveManagementDraft(client,profile,actorId,clientId,resource,input){
  requireClientManagement(profile);if(!uuid.test(actorId||''))throw managementError(403,'Authenticated administrator required.');
  if(clientId&&!uuid.test(clientId))throw managementError(400,'Invalid client.');
  if(!clientId&&resource!=='client')throw managementError(400,'Select a client draft first.');
  const payload=validateDraftInput(resource,input);
  return data(client.rpc('rpc_save_residential_ticketing_draft',{p_actor:actorId,p_client:clientId||null,p_resource:resource,p_payload:payload}));
}
