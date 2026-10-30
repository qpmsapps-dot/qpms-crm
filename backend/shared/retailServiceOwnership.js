import {ownershipAt} from './retailUnifiedModel.js';
export function serviceOrderOwnership(snapshot,order,at){
 return (order?.store_ids||[]).map(store_id=>{const store=snapshot.stores.find(s=>s.id===store_id);return {store_id,store_code:store?.store_code||null,...(store?ownershipAt(snapshot,store,at):{known:false,zone_id:null,fo_profile_id:null})};});
}
