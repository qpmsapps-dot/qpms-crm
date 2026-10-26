import express from 'express';
import { listManagementClients,loadManagementDraft,saveManagementDraft,requireClientManagement } from '../services/clientTicketingManagementService.js';
export function createClientTicketingManagementRouter({getClient}){
  const router=express.Router();
  router.use((req,res,next)=>{try{requireClientManagement(req.profile);next();}catch(e){res.status(e.statusCode||403).json({ok:false,message:e.message});}});
  const fail=(res,e)=>{const status=e.statusCode||(e.code==='23505'?409:e.code==='42501'?403:e.code==='22023'?400:e.code==='PGRST202'?503:500);res.status(status).json({ok:false,code:e.code||'client_configuration_failed',message:status>=500?'Client configuration is unavailable. Verify the prepared migration in the isolated environment.':e.message});};
  router.get('/',async(req,res)=>{try{res.json({ok:true,...await listManagementClients(getClient(),req.profile)});}catch(e){fail(res,e);}});
  router.get('/:clientId',async(req,res)=>{try{res.json({ok:true,...await loadManagementDraft(getClient(),req.profile,req.params.clientId)});}catch(e){fail(res,e);}});
  router.post('/',async(req,res)=>{try{res.status(201).json({ok:true,result:await saveManagementDraft(getClient(),req.profile,req.authUser?.id,null,'client',req.body||{})});}catch(e){fail(res,e);}});
  router.post('/:clientId/:resource',async(req,res)=>{try{res.json({ok:true,result:await saveManagementDraft(getClient(),req.profile,req.authUser?.id,req.params.clientId,req.params.resource,req.body||{})});}catch(e){fail(res,e);}});
  return router;
}
