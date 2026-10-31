import {canOperateOos} from '../shared/retailOosAccess.js';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {parseQuotation} from '../services/retailQuotationImport.js';
import {unifiedSnapshot} from '../services/retailUnifiedService.js';
export function createRetailServiceTrackerRouter({getClient,environment=process.env}){
 const router=express.Router(),rpc=async(c,name,args)=>{const {data,error}=await c.rpc(name,args);if(error)throw error;return data;};
 const oosActions=['PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED'];
 const oosMutationGate=(req,res,next)=>environment.RETAIL_OOS_MUTATIONS_FROZEN==='true'?res.status(503).json({ok:false,code:'OOS_MUTATIONS_FROZEN',message:'OOS mutations are temporarily frozen.'}):next();
 const run=fn=>async(req,res)=>{try{res.json({ok:true,result:await fn(getClient(),req)});}catch(e){const status=e.code==='42501'?403:['PGRST202','42P01'].includes(e.code)?503:['23505','40001','P0001'].includes(e.code)?409:e.statusCode||400;res.status(status).json({ok:false,message:status===503?'Required Service Tracker capability is unavailable. Advanced quotation rework requires the separately authorized V2 rework migration; existing progress is preserved.':status===400?'Invalid Service Tracker request.':status===403?'Outside authorized Service Tracker scope.':e.message});}};
 router.get('/',run((c,r)=>rpc(c,'rpc_retail_service_snapshot',{p_actor:r.profile.id})));
 for(const operation of ['preview','import','rework'])router.post('/quotation/'+operation,(req,res,next)=>operation==='preview'?next():oosMutationGate(req,res,next),express.raw({type:'application/octet-stream',limit:'10mb'}),run(async(c,r)=>{
  const master=await unifiedSnapshot(c,r.profile),parsed=parseQuotation(r.body,decodeURIComponent(r.get('x-file-name')||''),master.stores);
  const current=await rpc(c,'rpc_retail_service_snapshot',{p_actor:r.profile.id});
  const plan=parsed.groups.map(g=>{const order=current.orders.find(o=>o.kind==='OOS'&&o.reference===g.quotation_number);const seen=order&&(order.details?.file_sha256===parsed.sha256||order.details?.quotation_file_sha256===parsed.sha256||current.events.some(e=>e.order_id===order.id&&[e.evidence?.file_sha256,e.evidence?.quotation_file_sha256].includes(parsed.sha256)));return {reference:g.quotation_number,order_id:order?.id,revision:order?.revision,status:order?.status,disposition:!order?'NEW':seen?'UNCHANGED':order.status==='QUOTED'?'REWORK':'REWORK_REQUIRES_V2'};});
  if(operation==='preview')return {...parsed,original_base64:undefined,plan};
  if(!canOperateOos(r.profile))throw Object.assign(Error('Authorized OOS MIS access required.'),{statusCode:403});
  if(!parsed.can_save)throw Object.assign(Error('Correct quotation errors before saving.'),{statusCode:409});
  if(plan.length&&plan.every(p=>p.disposition==='UNCHANGED'))return {replayed:true,source_rows:parsed.source_rows,unchanged:plan.length,operational_writes:0,plan};
  const reworkRpc=plan.some(p=>p.disposition==='REWORK_REQUIRES_V2')?'rpc_retail_service_rework_v2':'rpc_retail_service_command';
  if(operation==='import'&&plan.some(p=>['REWORK','REWORK_REQUIRES_V2'].includes(p.disposition))){
   if(plan.length!==1)throw Object.assign(Error('Upload revised quotations individually to preserve atomic version history.'),{statusCode:409});
   const g=parsed.groups[0],p=plan[0];return rpc(c,reworkRpc,{p_actor:r.profile.id,p_request:r.get('x-request-id')||randomUUID(),p_action:'REWORK',p_order:p.order_id,p_revision:p.revision,p_data:{reference:g.quotation_number,store_ids:g.store_ids,items:g.items,reason:'Revised quotation workbook upload',quotation_file_sha256:parsed.sha256,original_base64:parsed.original_base64}});
  }
  if(operation==='rework'){
   if(parsed.groups.length!==1)throw Error('One quotation required for rework');const g=parsed.groups[0];
   return rpc(c,reworkRpc,{p_actor:r.profile.id,p_request:r.get('x-request-id'),p_action:'REWORK',p_order:r.get('x-order-id'),p_revision:Number(r.get('x-order-revision')),p_data:{reference:g.quotation_number,store_ids:g.store_ids,items:g.items,reason:decodeURIComponent(r.get('x-rework-reason')||''),quotation_file_sha256:parsed.sha256,original_base64:parsed.original_base64}});
  }
  return {source_rows:parsed.source_rows,...await rpc(c,'rpc_retail_service_import',{p_actor:r.profile.id,p_sha256:parsed.sha256,p_filename:parsed.filename,p_original:parsed.original_base64,p_groups:parsed.groups})};
 }));
 router.post('/command',(req,res,next)=>oosActions.includes(req.body?.action)?oosMutationGate(req,res,next):next(),run(async(c,r)=>{
  if(!r.body||!['REGISTER_FAULT','ESCALATE',...oosActions,'ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'].includes(r.body.action))throw Error('Unsupported action');
  if(oosActions.includes(r.body.action)&&!canOperateOos(r.profile))throw Object.assign(Error('Authorized OOS MIS access required.'),{statusCode:403});
  if(r.body.action==='COMMERCIALLY_CONFIRMED'){
   const snapshot=await rpc(c,'rpc_retail_service_snapshot',{p_actor:r.profile.id}),order=snapshot.orders.find(o=>o.id===r.body.order_id);
   if(!order||order.kind!=='OOS'||!order.created_by||String(order.created_by).toLowerCase()===String(r.profile.id).toLowerCase())throw Object.assign(Error('Independent commercial reviewer and persisted creator identity required.'),{statusCode:403});
   const master=await unifiedSnapshot(c,r.profile);
   if(!master.admin&&!master.permissions?.some(p=>p.state===order.state&&p.permission==='reviewer'))throw Object.assign(Error('Authorized state reviewer required.'),{statusCode:403});
  }
  return rpc(c,'rpc_retail_service_command',{p_actor:r.profile.id,p_request:r.body.request_id,p_action:r.body.action,p_order:r.body.order_id||null,p_revision:r.body.revision??null,p_data:r.body.data});
 }));
 router.use((e,req,res,next)=>e?res.status(e.type==='entity.too.large'?413:400).json({ok:false,message:'Invalid tracker upload.'}):next());
 return router;
}
