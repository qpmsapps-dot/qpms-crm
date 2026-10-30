import express from 'express';
import {parseQuotation} from '../services/retailQuotationImport.js';
import {unifiedSnapshot} from '../services/retailUnifiedService.js';
export function createRetailServiceTrackerRouter({getClient}){
 const router=express.Router(),rpc=async(c,name,args)=>{const {data,error}=await c.rpc(name,args);if(error)throw error;return data;};
 const run=fn=>async(req,res)=>{try{res.json({ok:true,result:await fn(getClient(),req)});}catch(e){const status=e.code==='42501'?403:['PGRST202','42P01'].includes(e.code)?503:['23505','40001','P0001'].includes(e.code)?409:e.statusCode||400;res.status(status).json({ok:false,message:status===503?'Service Tracker database setup awaits authorization.':status===400?'Invalid Service Tracker request.':status===403?'Outside authorized Service Tracker scope.':e.message});}};
 router.get('/',run((c,r)=>rpc(c,'rpc_retail_service_snapshot',{p_actor:r.profile.id})));
 for(const operation of ['preview','import','rework'])router.post('/quotation/'+operation,express.raw({type:'application/octet-stream',limit:'10mb'}),run(async(c,r)=>{
  const master=await unifiedSnapshot(c,r.profile),parsed=parseQuotation(r.body,decodeURIComponent(r.get('x-file-name')||''),master.stores);
  if(operation==='preview')return {...parsed,original_base64:undefined};
  if(!parsed.can_save)throw Object.assign(Error('Correct quotation errors before saving.'),{statusCode:409});
  if(operation==='rework'){
   if(parsed.groups.length!==1)throw Error('One quotation required for rework');const g=parsed.groups[0];
   return rpc(c,'rpc_retail_service_command',{p_actor:r.profile.id,p_request:r.get('x-request-id'),p_action:'REWORK',p_order:r.get('x-order-id'),p_revision:Number(r.get('x-order-revision')),p_data:{reference:g.quotation_number,store_ids:g.store_ids,items:g.items,reason:decodeURIComponent(r.get('x-rework-reason')||''),quotation_file_sha256:parsed.sha256,original_base64:parsed.original_base64}});
  }
  return {source_rows:parsed.source_rows,...await rpc(c,'rpc_retail_service_import',{p_actor:r.profile.id,p_sha256:parsed.sha256,p_filename:parsed.filename,p_original:parsed.original_base64,p_groups:parsed.groups})};
 }));
 router.post('/command',run((c,r)=>{if(!r.body||!['REGISTER_FAULT','ESCALATE','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'].includes(r.body.action))throw Error('Unsupported action');return rpc(c,'rpc_retail_service_command',{p_actor:r.profile.id,p_request:r.body.request_id,p_action:r.body.action,p_order:r.body.order_id||null,p_revision:r.body.revision??null,p_data:r.body.data});}));
 router.use((e,req,res,next)=>e?res.status(e.type==='entity.too.large'?413:400).json({ok:false,message:'Invalid tracker upload.'}):next());
 return router;
}
