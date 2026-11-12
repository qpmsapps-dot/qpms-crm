import {isInitialRetailAdmin} from './retailInitialAdminAccess.js';
export function phase6AdminReadAccess(req){
 if(req.method!=='GET'||!req.authUser?.id||!isInitialRetailAdmin(req.profile,req.authUser))return null;
 if(!/^(?:\/access|\/report\/training-(?:hk|mepc)|\/existing-evidence\/training-(?:hk|mepc)\/[^/]+\/[^/]+)\/?$/.test(req.path))return null;
 return {active:true,role:'CENTRAL_MIS',states:['AP-1','AP-2','KA','KL','TG','TN','PY'],read_only:true,phase6_admin_read:true};
}
