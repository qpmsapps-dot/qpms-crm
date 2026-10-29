import express from 'express';
import {unifiedSnapshot,previewUnified,stageUnified,createPendingStore,proposeUnified,decideUnified,applyUnified} from '../services/retailUnifiedService.js';
export function createRetailUnifiedRouter({getClient,environment=process.env}){
 const router=express.Router();
 const run=handler=>async(req,res)=>{try{res.json({ok:true,result:await handler(getClient(),req.profile,req.body,req)});}catch(e){const status=e.statusCode||({'42501':403,'40001':409,'23505':409,P0001:409,'22P02':400,'22007':400,PGRST202:503,'42P01':503}[e.code])||500;res.status(status).json({ok:false,message:status===503?'Unified Store Master setup is awaiting authorized database installation.':status>=500?'Unified Store Master is unavailable.':e.message});}};
 router.get('/',run((c,p,b,r)=>unifiedSnapshot(c,p,r.query)));
 for(const operation of ['preview','stage'])router.post('/'+operation,express.raw({type:['application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],limit:'10mb'}),run((c,p,b,r)=>{
  let name;try{name=decodeURIComponent(r.get('x-file-name')||'');}catch{throw Object.assign(Error('Invalid filename.'),{statusCode:400});}
  return operation==='preview'?previewUnified(c,p,b,name):stageUnified(c,p,b,name,r.get('x-preview-stamp'));
 }));
 router.post('/pending-store',run(createPendingStore));router.post('/propose',run(proposeUnified));router.post('/decide',run(decideUnified));router.post('/apply',run((c,p,b)=>applyUnified(c,p,b,environment)));
 router.use((e,req,res,next)=>{if(!e)return next();res.status(e.type==='entity.too.large'?413:400).json({ok:false,message:'Invalid request; Excel files must be .xlsx up to 10 MB.'});});
 return router;
}
