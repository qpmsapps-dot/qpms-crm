import {assertRetailAccess} from './relianceRetailManagementService.js';
import {indiaToday,validDate} from '../shared/retailAttendance.js';
import {operationMonth,maintenanceReport,thermographyReport} from '../shared/retailOperations.js';

const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function access(profile,kind) {
  assertRetailAccess(profile,kind==='maintenance'?'cmpm':'thermography');
  if(profile.is_active!==true||String(profile.status||'Active').toUpperCase()!=='ACTIVE')throw fail(403,'Active authorized Retail profile required.');
}
async function rpc(client,name,args) {
  const {data,error}=await client.rpc(name,args);
  if(error){
    if(['PGRST202','42P01','42883'].includes(error.code))throw fail(503,'Operational workflow database setup awaits authorized release. Totals are unavailable.');
    if(error.code==='42501')throw fail(403,error.message);
    if(['23505','40001'].includes(error.code))throw fail(409,error.message);
    if(error.code==='22023')throw fail(400,error.message);
    throw fail(503,'Operational report unavailable. No save or reporting result can be confirmed.');
  }
  return data;
}
export async function retailOperationsSource(client,profile,kind,input={}) {
  access(profile,kind);const month=input.month||indiaToday().slice(0,7);
  let first;try{first=operationMonth(month);}catch(e){throw fail(400,e.message);}
  const source=await rpc(client,'rpc_retail_operations_snapshot',{p_actor:profile.id,p_month:first});
  if(input.store&&!source.stores.some(s=>s.id===input.store))throw fail(403,'Store is outside the authorized scope.');
  return {source,month};
}
export async function retailOperationsReport(client,profile,kind,input={}) {
  const {source,month}=await retailOperationsSource(client,profile,kind,input);
  return kind==='maintenance'?maintenanceReport(source,month,input):thermographyReport(source,month,input);
}
export async function completeRetailMaintenance(client,profile,input) {
  access(profile,'maintenance');
  if(!uuid(input.store_id)||!uuid(input.request_id))throw fail(400,'Select an authorized store and provide a request ID.');
  if(!['CM','PM'].includes(input.kind))throw fail(400,'Select CM or PM.');
  let first;try{first=operationMonth(input.month);}catch(e){throw fail(400,e.message);}
  return rpc(client,'rpc_retail_maintenance_complete',{p_actor:profile.id,p_store:input.store_id,p_kind:input.kind,p_month:first,p_request:input.request_id});
}
export async function commandRetailThermography(client,profile,input) {
  access(profile,'thermography');
  if(!uuid(input.request_id)||!['Scheduled','Completed','Client Approved'].includes(input.status))throw fail(400,'Valid status and request ID required.');
  if(input.status==='Scheduled'){
    if(!uuid(input.store_id))throw fail(400,'Select an authorized store.');
    try{validDate(input.scheduled_date);}catch{throw fail(400,'Select a valid scheduled date.');}
  }else if(!uuid(input.id)||!Number.isInteger(input.revision)||input.revision<1)throw fail(400,'Inspection and current revision required.');
  return rpc(client,'rpc_retail_thermography_command',{p_actor:profile.id,p_action:input.status,p_store:input.store_id||null,p_record:input.id||null,p_scheduled:input.scheduled_date||null,p_revision:input.revision??null,p_request:input.request_id});
}
