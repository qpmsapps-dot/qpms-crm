import express from 'express';
import {retailOperationsReport,completeRetailMaintenance,commandRetailThermography} from '../services/retailOperationsService.js';

// Parent router supplies the established JWT middleware. Actor IDs never come
// from browser payloads; every database command rechecks existing state grants.
export function createRetailOperationsRouter({getClient}) {
  const router=express.Router();
  const run=fn=>async(req,res)=>{try{if(!req.profile?.id)return res.status(401).json({ok:false,message:'Authentication required.'});res.json({ok:true,result:await fn(getClient(),req)});}catch(e){const status=e.statusCode||400;res.status(status).json({ok:false,message:e.statusCode?e.message:'Invalid operational request.'});}};
  router.get('/maintenance',run((c,r)=>retailOperationsReport(c,r.profile,'maintenance',r.query)));
  router.post('/maintenance',express.json({limit:'8kb'}),run((c,r)=>completeRetailMaintenance(c,r.profile,r.body||{})));
  router.get('/thermography',run((c,r)=>retailOperationsReport(c,r.profile,'thermography',r.query)));
  router.post('/thermography',express.json({limit:'8kb'}),run((c,r)=>commandRetailThermography(c,r.profile,r.body||{})));
  return router;
}
