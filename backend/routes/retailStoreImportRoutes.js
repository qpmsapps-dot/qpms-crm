import express from 'express';
import { storeImportAdmin,storeImportCapability,previewStoreImport,confirmStoreImport,rollbackStoreImport,storeImportHistory } from '../services/retailStoreImportService.js';
import { previewStoreAttendanceRecovery,confirmStoreAttendanceRecovery } from '../services/retailStoreAttendanceRecovery.js';
import { previewBulkIdentity,confirmBulkIdentity } from '../services/retailBulkIdentityService.js';

export function createRetailStoreImportRouter({getClient,environment=process.env}) {
  const router=express.Router();
  const run=handler=>async(req,res)=>{try{res.json({ok:true,...await handler(req)});}catch(e){const status=e.statusCode||(['23505','40001','P0001'].includes(e.code)?409:500);res.status(status).json({ok:false,message:status>=500?'Store import is unavailable. Contact your administrator.':e.message});}};
  router.get('/capability',run(async req=>({capability:await storeImportCapability(getClient(),req.profile)})));
  router.use((req,res,next)=>{try{storeImportAdmin(req.profile);next();}catch(e){res.status(403).json({ok:false,message:e.message});}});
  router.post('/preview',express.raw({type:'application/octet-stream',limit:'10mb'}),run(async req=>{
    let name;try{name=decodeURIComponent(req.get('x-file-name')||'');}catch{throw Object.assign(Error('Invalid filename'),{statusCode:400});}
    return {preview:await previewStoreImport(getClient(),req.profile,req.body,name),activation_enabled:environment.RETAIL_STORE_IMPORT_WRITES_ENABLED==='true'};
  }));
  router.get('/history',run(async req=>({history:await storeImportHistory(getClient(),req.profile)})));
  router.post('/bulk-identity/preview',express.raw({type:'application/octet-stream',limit:'10mb'}),run(async req=>({preview:await previewBulkIdentity(getClient(),req.profile,req.body,decodeURIComponent(req.get('x-file-name')||''),req.get('x-source-batch-id')),approval_enabled:environment.RETAIL_BULK_IDENTITY_APPROVALS_ENABLED==='true'})));
  router.post('/bulk-identity/confirm',run(async req=>({receipt:await confirmBulkIdentity(getClient(),req.profile,req.body||{},environment)})));
  router.post('/confirm',run(async req=>({receipt:await confirmStoreImport(getClient(),req.profile,req.body||{},environment)})));
  router.post('/rollback',run(async req=>({receipt:await rollbackStoreImport(getClient(),req.profile,req.body||{},environment)})));
  router.post('/recovery/preview',run(async req=>({preview:await previewStoreAttendanceRecovery(getClient(),req.profile,req.body||{}),activation_enabled:environment.RETAIL_STORE_ATTENDANCE_REPROCESS_ENABLED==='true'})));
  router.post('/recovery/confirm',run(async req=>({batch_id:await confirmStoreAttendanceRecovery(getClient(),req.profile,req.body||{},environment)})));
  router.use((e,req,res,next)=>{if(!e)return next();res.status(e.type==='entity.too.large'?413:400).json({ok:false,message:'Invalid upload. Select an .xlsx file up to 10 MB.'});});
  return router;
}
