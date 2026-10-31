import {savedReviewSource,proposeSavedIdentities,decideSavedReviews,activateSavedIdentities,proposeSavedAop,applySavedAop} from '../services/retailSavedReviewService.js';
import express from 'express';
import {previewZoneWorkbook,parseZoneMappingWorkbook,submitZoneRecords} from '../services/retailZoneMappingService.js';
import {previewZoneMappings} from '../shared/retailZoneMapping.js';
import {unifiedSnapshot,previewUnified,stageUnified,createPendingStore,proposeUnified,decideUnified,applyUnified} from '../services/retailUnifiedService.js';
export function createRetailUnifiedRouter({getClient,environment=process.env}){
 const router=express.Router();
 const run=handler=>async(req,res)=>{try{res.json({ok:true,result:await handler(getClient(),req.profile,req.body,req)});}catch(e){const status=e.statusCode||({'42501':403,'40001':409,'23505':409,P0001:409,'22P02':400,'22007':400,PGRST202:503,'42P01':503}[e.code])||500;res.status(status).json({ok:false,...(e.validation_code?{code:e.validation_code,details:e.validation_details||[]}:{}),message:status===503?(req.path.startsWith('/zone-mapping')?'Provisional Zone draft storage awaits separate authorized setup. Do not rerun installed Unified migrations.':'Unified Store Master setup is awaiting authorized database installation.'):status>=500?'Unified Store Master is unavailable.':e.message});}};
 router.get('/saved-review',run((c,p,b,r)=>savedReviewSource(c,p,r.query,environment)));
 router.post('/saved-review/identity-propose',run(proposeSavedIdentities));
 router.post('/saved-review/decide',run(decideSavedReviews));
 router.post('/saved-review/identity-activate',run((c,p,b)=>activateSavedIdentities(c,p,b,environment)));
 router.post('/saved-review/aop-propose',run(proposeSavedAop));
 router.post('/saved-review/aop-apply',run((c,p,b)=>applySavedAop(c,p,b,environment)));
 router.get('/',run((c,p,b,r)=>unifiedSnapshot(c,p,r.query)));
 for(const operation of ['preview','submit'])router.post('/zone-mapping/'+operation,express.raw({type:'application/octet-stream',limit:'10mb'}),run((c,p,b,r)=>{
  let name;try{name=decodeURIComponent(r.get('x-file-name')||'');}catch{throw Object.assign(Error('Invalid filename.'),{statusCode:400});}
  return operation==='preview'?previewZoneWorkbook(c,p,b,name):submitZoneRecords(c,p,parseZoneMappingWorkbook(b,name),r.get('x-preview-stamp'));
 }));
 router.post('/zone-mapping/records-preview',run(async(c,p,b)=>{if(!Array.isArray(b?.records)||b.records.length>1000)throw Object.assign(Error('Up to 1000 mapping records required.'),{statusCode:400});return previewZoneMappings(b.records,await unifiedSnapshot(c,p));}));
 router.post('/zone-mapping/records-submit',run((c,p,b)=>submitZoneRecords(c,p,b?.records,b?.stamp)));
 router.get('/zone-mapping/drafts',run(async(c,p)=>{const {data,error}=await c.rpc('rpc_retail_zone_drafts',{p_actor:p.id});if(error)throw error;return data;}));
 for(const operation of ['preview','stage'])router.post('/'+operation,express.raw({type:['application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],limit:'10mb'}),run((c,p,b,r)=>{
  let name;try{name=decodeURIComponent(r.get('x-file-name')||'');}catch{throw Object.assign(Error('Invalid filename.'),{statusCode:400});}
  return operation==='preview'?previewUnified(c,p,b,name):stageUnified(c,p,b,name,r.get('x-preview-stamp'));
 }));
 router.post('/pending-store',run(createPendingStore));router.post('/propose',run(proposeUnified));router.post('/decide',run(decideUnified));router.post('/apply',run((c,p,b)=>applyUnified(c,p,b,environment)));
 router.use((e,req,res,next)=>{if(!e)return next();res.status(e.type==='entity.too.large'?413:400).json({ok:false,message:'Invalid request; Excel files must be .xlsx up to 10 MB.'});});
 return router;
}
