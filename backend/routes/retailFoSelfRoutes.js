import express from 'express';
import {indiaToday,validDate} from '../shared/retailAttendance.js';
const normalized=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function createRetailFoSelfRouter({getClient}){
 const router=express.Router(); // Parent mounts this AFTER verified JWT -> database profile resolution.
 router.get('/',async(req,res)=>{try{
  const p=req.profile;
  if(!p?.id||p.is_active!==true||(p.status&&normalized(p.status)!=='ACTIVE')||
    !['FO','FIELDOFFICER'].includes(normalized(p.role))||!['RELIANCE','RELIANCERETAIL'].includes(normalized(p.business)))
   return res.status(403).json({ok:false,message:'Active Reliance Retail FO profile required.'});
  if(Object.keys(req.query).some(k=>!['from','to'].includes(k))||Object.values(req.query).some(v=>typeof v!=='string'))
   return res.status(400).json({ok:false,message:'Only from/to dates are accepted. Profile identity comes from your authenticated session.'});
  let from,to;try{to=validDate(req.query.to||indiaToday());from=validDate(req.query.from||to.slice(0,7)+'-01');}catch{return res.status(400).json({ok:false,message:'Valid ISO from/to dates required.'});}
  if(to<from||to>indiaToday()||(Date.parse(to)-Date.parse(from))/86400000>92)
   return res.status(400).json({ok:false,message:'Select a nonfuture range of up to 93 days.'});
  const {data,error}=await getClient().rpc('rpc_retail_fo_self_snapshot',{p_actor:p.id,p_from:from,p_to:to});
  if(error)throw error;
  if(data?.scope!=='FO_SELF'||data.actor_id!==p.id||!Array.isArray(data.fos)||data.fos.length!==1||data.fos[0].id!==p.id||
   !Array.isArray(data.self_days)||data.self_days.some(d=>d.fo_id!==p.id)||
   !Array.isArray(data.self_current_stores)||data.self_current_stores.some(s=>s.current_owner?.fo_profile_id!==p.id)||
   !Array.isArray(data.assignments)||data.assignments.some(a=>a.fo_profile_id!==p.id))
   return res.status(503).json({ok:false,message:'FO self-service scope verification failed.'});
  return res.json({ok:true,result:data});
 }catch(e){const status=e.code==='42501'?403:['PGRST202','42883','42P01'].includes(e.code)?503:['22023','22007'].includes(e.code)?400:500;
  return res.status(status).json({ok:false,message:status===503?'FO self-service requires the reviewed 20261030170000 database permission package. Ask the DB owner to verify/install that package; no state-wide grant is required.':status===403?'Active Reliance Retail FO profile required.':status===400?e.message:'FO self-service is unavailable.'});
 }});
 router.all('/',(req,res)=>res.status(405).json({ok:false,message:'FO self-service is read-only.'}));
 return router;
}
