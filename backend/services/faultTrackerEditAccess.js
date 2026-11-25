import {isInitialRetailAdmin} from './retailInitialAdminAccess.js';

// Exact, owner-authorized identities for Fault Tracker ticket editing only.
const EDITORS=Object.freeze([
 Object.freeze({id:'2a1d8895-ce8d-4bf0-9d70-dbc6af60414b',auth_user_id:'7e84cddf-821a-4513-b7ce-25895d660393',employee_code:'QPMSAP25191'}),
 Object.freeze({id:'e2457d7a-018b-477e-9ba6-bd1021ed16aa',auth_user_id:'377ca7a2-95cc-4891-8840-338f2cb20bb9',employee_code:'QPMSTNC17010'}),
]);
export function canEditFaultTracker(profile,authUser){
 if(isInitialRetailAdmin(profile,authUser))return true;
 const role=String(profile?.role||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 return profile?.is_active===true&&String(profile.status||'Active').toUpperCase()==='ACTIVE'
  &&profile.web_access_enabled===true&&['ADMIN','QPMSADMIN'].includes(role)
  &&(!authUser||authUser.id===profile.auth_user_id)
  &&EDITORS.some(identity=>Object.entries(identity).every(([key,value])=>profile[key]===value));
}
export function requireFaultTrackerEditor(req,res,next){
 if(!req.authUser?.id||!req.profile?.id)return res.status(401).json({ok:false,message:'Authentication required.'});
 if(!canEditFaultTracker(req.profile,req.authUser))return res.status(403).json({ok:false,code:'fault_tracker_editor_required',message:'Authorized Fault Tracker editor required.'});
 return next();
}
