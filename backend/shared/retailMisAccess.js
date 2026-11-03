// Explicit assignment roles only. Never promote legacy MIS/designation aliases.
export const RETAIL_MIS_ROLES = Object.freeze({CENTRAL_MIS:'Central MIS',MIS_HK:'HK-MIS',MIS_MEPC:'MEPC-MIS',MIS_OOS:'OOS-MIS'});
export const RETAIL_MIS_ASSIGNABLE_ROLES = Object.freeze(['MIS_HK','MIS_MEPC','MIS_OOS']);
export const RETAIL_OOS_STATES = Object.freeze(['TN','KA','KL','TG','AP-1','AP-2']);
export const retailOosState = value => retailMisState(value)==='PY'?'TN':retailMisState(value);
export const RETAIL_MIS_STATES = Object.freeze(['AP-1','AP-2','KA','KL','TG','TN','PY']);
export const RETAIL_MIS_MODULES = Object.freeze({
 CENTRAL_MIS:['dashboard','stores','attendance-hk','attendance-mepc','cleaning','pest','training-hk','training-mepc','fault','maintenance','thermography','oos','imports'],
 MIS_HK:['stores','attendance-hk','cleaning','pest','training-hk'],
 MIS_MEPC:['stores','attendance-mepc','fault','maintenance','thermography'],
 MIS_OOS:['oos'],
});
export const PADMA_RETAIL_IDENTITY = Object.freeze({profile_id:'83231458-af73-435a-abda-48bec9f29e5e',auth_user_id:'e843bc42-5f61-474d-8eca-1cf8d01ce2c1',employee_code:'QPMSAP2519'});
export const RETAIL_MIS_ASSIGNMENT_ADMIN = Object.freeze({profile_id:'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',auth_user_id:'79cd196c-c6f3-404a-b22a-d4683afefa3f',employee_code:'QPMSADMIN'});
export function retailMisRole(value){return Object.hasOwn(RETAIL_MIS_ROLES,value)?value:null;}
export function retailMisApiAllowed(profile,path){return !retailMisRole(profile?.role)||/^\/api\/(?:reliance-retail\/(?:mis(?:\/|$)|access$)|profile\/(?:me|password-setup-complete|avatar)$)/.test(path);}
export function retailMisState(value){const s=String(value||'').trim().toUpperCase();return s==='KN'?'KA':RETAIL_MIS_STATES.includes(s)?s:null;}
export function retailMisScopeStates(states){
 if(!Array.isArray(states)||!states.length)throw Object.assign(Error('Assign one or more explicit Retail states; AP and All States are not state grants.'),{statusCode:400});
 const result=states.map(retailOosState);if(result.some(s=>!s))throw Object.assign(Error('Unknown or ambiguous Retail state.'),{statusCode:400});
 // Six-state selection; only OOS authorization consolidates original PY stores.
 return [...new Set(result)].sort();
}
export function retailMisCan(access,module,state){return Boolean(access?.active===true&&RETAIL_MIS_MODULES[access.role]?.includes(module)&&(!state||retailMisState(state)&&(access.role==='CENTRAL_MIS'||access.states?.some(s=>(module==='oos'?retailOosState(s):retailMisState(s))===(module==='oos'?retailOosState(state):retailMisState(state))))));}
export function assertRetailMis(access,module,state){if(!retailMisCan(access,module,state))throw Object.assign(Error('Outside assigned Retail role, module or geographic state.'),{statusCode:403});return access;}
export function retailMisRouteModule(path){
 const match=String(path).match(/^\/reliance-retail\/mis\/([a-z-]+)\/?$/);return match?.[1]||null;
}
export function retailMisHome(role){return '/reliance-retail/mis/'+(RETAIL_MIS_MODULES[role]?.[0]||'dashboard');}
export function verifyPadmaIdentity(profile){return Object.entries(PADMA_RETAIL_IDENTITY).every(([k,v])=>(k==='profile_id'?profile?.id:profile?.[k])===v)&&profile?.is_active===true;}
export function assertScopedQuotation(groups,stores,access){
 assertRetailMis(access,'oos');if(!groups?.length)throw Object.assign(Error('Valid quotation groups required.'),{statusCode:400});
 const states=new Set();for(const g of groups){const ids=new Set(g.store_ids||[]);if(!ids.size)throw Object.assign(Error('Quotation has no canonical stores.'),{statusCode:400});
  for(const id of ids){const matches=stores.filter(s=>s.id===id&&s.status==='Active');if(matches.length!==1)throw Object.assign(Error('Canonical Store Code unavailable.'),{statusCode:403});const s=matches[0];if(stores.filter(x=>String(x.store_code).trim().toUpperCase()===String(s.store_code).trim().toUpperCase()).length!==1)throw Object.assign(Error('Ambiguous Store Code.'),{statusCode:409});assertRetailMis(access,'oos',s.state);states.add(retailOosState(s.state));}
  if(!g.items?.length||g.items.some(i=>!ids.has(i.store_id)))throw Object.assign(Error('Quotation item/store mismatch.'),{statusCode:400});
 }
 if(states.size!==1)throw Object.assign(Error('Cross-state quotation files must be resolved as separately approved quotations; no partial import.'),{statusCode:403});
 return [...states][0];
}
