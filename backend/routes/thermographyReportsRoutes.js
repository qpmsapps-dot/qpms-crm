import express from 'express';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {THERMO_MAX_BYTES,THERMO_MIME} from '../services/thermographyPdf.js';
import {thermoReportRpc,thermoUploadLimit,prepareThermoUpload,finalizeThermoUpload,thermoDownload,thermoReportAction,cleanupThermoUploads} from '../services/thermographyReportsService.js';
import {thermoDashboard} from '../services/thermographyDashboard.js';
import {scheduleUpload,scheduleRpc,SCHEDULE_MAX_BYTES} from '../services/thermographySchedule.js';

export function createThermographyReportsRouter({getClient,environment=process.env,options={}}){
 const router=express.Router();
 router.use((req,res,next)=>{
  if(!req.authUser?.id||req.profile?.auth_user_id!==req.authUser.id)return res.status(401).json({ok:false,message:'Verified account required.'});next();
 });
 router.use((req,res,next)=>{
  if(environment.THERMOGRAPHY_REPORT_WRITES_ENABLED==='false'&&!['GET','HEAD','OPTIONS'].includes(req.method))return res.status(503).json({ok:false,message:'Thermography report actions are paused. Existing PDF reports remain available for authorized download.'});next();
 });
 const run=fn=>async(req,res)=>{try{res.set('Cache-Control','private, no-store');res.json({ok:true,result:await fn(getClient(),req)});}catch(e){options.onError?.(e);res.status(e.statusCode||503).json({ok:false,message:e.statusCode?e.message:'Thermography request unavailable. No result can be confirmed.'});}};
 const maxBytes=()=>{const size=Number(environment.THERMOGRAPHY_REPORT_MAX_BYTES||THERMO_MAX_BYTES);if(!Number.isSafeInteger(size)||size<22||size>THERMO_MAX_BYTES)throw Object.assign(Error('Thermography upload limit configuration is invalid.'),{statusCode:503});return size;};
 router.get('/dashboard',run(async(c,r)=>{
  const result=await thermoDashboard(c,r.profile,r.query),enabled=environment.THERMOGRAPHY_REPORT_WRITES_ENABLED!=='false';
  return {...result,max_bytes:await thermoUploadLimit(c,maxBytes()),can_schedule:enabled&&result.can_schedule,can_upload:enabled&&result.can_upload,
   rows:result.rows.map(row=>enabled?row:{...row,can_upload:false,can_replace:false,can_approve:false})};
 }));
 router.get('/schedules/history',run((c,r)=>scheduleRpc(c,r.profile,'history')));
 for(const action of ['preview','import'])router.post('/schedules/'+action,express.raw({type:'application/octet-stream',limit:SCHEDULE_MAX_BYTES}),run((c,r)=>{
  if(!Buffer.isBuffer(r.body))throw Object.assign(Error('Schedule workbook bytes required.'),{statusCode:400});return scheduleUpload(c,r.profile,action,r.body,r.headers);
 }));
 router.get('/reports',run(async(c,r)=>{
  const result=await thermoReportRpc(c,r.profile,'list',r.query),enabled=environment.THERMOGRAPHY_REPORT_WRITES_ENABLED!=='false';
  return {...result,max_bytes:await thermoUploadLimit(c,maxBytes()),writes_enabled:enabled,can_upload:enabled&&result.can_upload,can_schedule:enabled&&result.can_schedule,
   rows:result.rows.map(row=>enabled?row:{...row,can_write:false,can_upload:false,can_replace:false,can_approve:false,can_restore:false,can_reopen:false})};
 }));
 router.post('/uploads/prepare',express.json({limit:'8kb'}),run((c,r)=>prepareThermoUpload(c,r.profile,r.body||{},{...options,maxBytes:maxBytes()})));
 router.post('/uploads/finalize',express.json({limit:'2kb'}),run((c,r)=>finalizeThermoUpload(c,r.profile,r.body||{},{...options,maxBytes:maxBytes()})));
 router.get('/reports/:id/history',run((c,r)=>thermoReportRpc(c,r.profile,'history',{...r.query,id:r.params.id})));
 router.post('/reports/:action',express.json({limit:'8kb'}),run((c,r)=>thermoReportAction(c,r.profile,r.params.action,r.body||{},options)));
 router.post('/cleanup',express.json({limit:'2kb'}),run((c,r)=>cleanupThermoUploads(c,r.profile)));
 const download=async(req,res)=>{
  try{
   const {version:v,response}=await thermoDownload(getClient(),req.profile,req.params.id,req.params.version,options);
   const safe=[...String(v.original_filename)].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||['/','\\','"'].includes(c)?'_':c).join('');
   res.set({'Content-Type':THERMO_MIME,'Content-Disposition':`attachment; filename="${safe.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/'/g,'%27')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Length':String(v.file_size)});
   let total=0;const bound=new Transform({transform(chunk,encoding,done){total+=chunk.length;done(total>Number(v.file_size)?Error('PDF size changed'):null,chunk);},flush(done){done(total!==Number(v.file_size)?Error('Incomplete PDF download'):null);}});
   await pipeline(Readable.fromWeb(response.body),bound,res);
  }catch(e){if(res.headersSent){res.destroy();return;}res.status(e.statusCode||503).json({ok:false,message:e.statusCode?e.message:'Private PDF download failed. Retry through the report.'});}
 };
 router.get('/reports/:id/download',download);
 router.get('/reports/:id/versions/:version/download',download);
 return router;
}
