import {indiaToday} from '../shared/retailAttendance.js';

// Existing account identity, verified read-only. UUIDs are identifiers, not keys.
// Relinking/replacing this account requires an explicitly reviewed policy update.
export const INITIAL_RETAIL_ADMIN=Object.freeze({
 profileId:'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',
 authUserId:'79cd196c-c6f3-404a-b22a-d4683afefa3f',
 employeeCode:'QPMSADMIN',
});
export function isInitialRetailAdmin(profile,authUser){
 const role=String(profile?.role||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 return profile?.id===INITIAL_RETAIL_ADMIN.profileId
  && profile.auth_user_id===INITIAL_RETAIL_ADMIN.authUserId
  && profile.employee_code===INITIAL_RETAIL_ADMIN.employeeCode
  && profile.is_active===true&&String(profile.status||'Active').toUpperCase()==='ACTIVE'
  && ['ADMIN','QPMSADMIN'].includes(role)
  && (!authUser||authUser.id===INITIAL_RETAIL_ADMIN.authUserId);
}
export function requireInitialRetailAdmin(req,res,next){
 if(!req.authUser?.id||!req.profile?.id)return res.status(401).json({ok:false,message:'Authentication required.'});
 if(!isInitialRetailAdmin(req.profile,req.authUser))return res.status(403).json({ok:false,code:'retail_initial_admin_only',message:'Retail operational writes are restricted to the existing QPMSADMIN account for this release.'});
 return next();
}

// Mounted only after the established JWT verifier. Do not inspect client-supplied
// actor/profile IDs as identity. Read/report/export and FO/Training/OOS routes keep
// their existing authorization. Review decisions retain independent approval.
export function createInitialRetailWriteGate({getClient}){
 return async(req,res,next)=>{
  const path=req.path.toLowerCase().replace(/\/+$/,'')||'/',method=req.method.toUpperCase();
  if(!['POST','PATCH','PUT','DELETE'].includes(method))return next();
  let protectedWrite=/^\/operations\/(maintenance|thermography)$/.test(path)
   || /^\/attendance\/(preview|commit)$/.test(path)
   || /^\/module-reports\/deep-cleaning\/[^/]+\/link-fo$/.test(path)
   || /^\/deep-cleaning\/schedules(?:\/[^/]+)?$/.test(path)
   || path==='/unified-master/propose'&&req.body?.kind==='DC_SCHEDULE';
  if(path==='/unified-master/apply'&&(!req.authUser?.id||!isInitialRetailAdmin(req.profile,req.authUser))){
   // Kind must come from the authorized database snapshot, never the request.
   // Other proposal kinds keep their existing apply rules and write gates.
   try{
    if(!req.profile?.id||!req.authUser?.id)return res.status(401).json({ok:false,message:'Authentication required.'});
    const today=indiaToday(),{data,error}=await getClient().rpc('rpc_retail_unified_snapshot',{p_actor:req.profile.id,p_from:today,p_to:today});
    if(error)return res.status(503).json({ok:false,message:'Proposal authorization could not be verified. No change was applied.'});
    const proposal=data?.proposals?.find(p=>p.id===req.body?.proposal_id);
    if(!proposal)return res.status(404).json({ok:false,message:'Proposal unavailable in your authorized scope.'});
    if(!['identity','zone','store_zone','zone_fo','HK','MEPC','DC_SCHEDULE'].includes(proposal.kind))return res.status(503).json({ok:false,message:'Proposal kind could not be verified. No change was applied.'});
    protectedWrite=proposal.kind==='DC_SCHEDULE';
   }catch{return res.status(503).json({ok:false,message:'Proposal authorization could not be verified. No change was applied.'});}
  }
  return protectedWrite?requireInitialRetailAdmin(req,res,next):next();
 };
}
