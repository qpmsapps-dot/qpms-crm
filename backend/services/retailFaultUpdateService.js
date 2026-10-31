import {RETAIL_FAULT_STAGES} from '../shared/retailFaultWorkflow.js';
import {scopedFaultTrackerReport} from './faultTrackerStoreScope.js';
const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
export async function updateRetailFault(client,profile,id,input,authorization){
 if(!authorization.isAdmin)throw fail(403,'Existing Fault Tracker management permission required.');
 if(!RETAIL_FAULT_STAGES.includes(input.stage)||typeof input.remarks!=='string'||input.remarks.length>4000||!/^[-a-f0-9]{36}$/i.test(input.request_id||'')||!Number.isFinite(Date.parse(input.expected_updated_at)))throw fail(400,'Valid stage, remarks, request ID and original record version required.');
 const scope=await scopedFaultTrackerReport(client,profile,{ticket_id:id,import_batch_id:input.import_batch_id},authorization);
 if(!scope.tickets.some(t=>t.id===id))throw fail(404,'Ticket unavailable in the authorized operational scope.');
 const {data,error}=await client.rpc('rpc_retail_fault_update',{p_actor:profile.id,p_ticket:id,p_stage:input.stage,p_remarks:input.remarks,p_expected:input.expected_updated_at,p_request:input.request_id});
 if(error){if(['PGRST202','42883'].includes(error.code))throw fail(503,'Persistent ticket updates await the reviewed database capability. No update was saved.');if(error.code==='42501')throw fail(403,'Ticket update is not authorized.');if(error.code==='40001')throw fail(409,'Ticket changed. Refresh before updating.');throw error;}
 return data;
}
