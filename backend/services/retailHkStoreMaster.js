import { retailMisState } from '../shared/retailMisAccess.js';

export function hkStoreStates(access, requested) {
  const deny = () => { throw Object.assign(Error('Outside assigned HK Store Master state.'), {statusCode:403}); };
  if (access?.active !== true || access.role !== 'MIS_HK' || !Array.isArray(access.states)) deny();
  const allowed = new Set(access.states.map(retailMisState).filter(Boolean));
  if (allowed.has('TN')) allowed.add('PY');
  if (!allowed.size) deny();
  if (requested == null || requested === '') return [...allowed].sort();
  const state = typeof requested === 'string' ? retailMisState(requested) : null;
  if (!state || !allowed.has(state)) deny();
  return state === 'TN' && allowed.has('PY') ? ['TN','PY'] : [state];
}

async function readAll(build) {
  const rows = [];
  for (let offset=0;;offset+=500) {
    const {data,error}=await build().range(offset,offset+499);
    if(error || !Array.isArray(data)) throw Object.assign(Error('Store Master data unavailable.'),{statusCode:503});
    rows.push(...data);
    if(data.length<500) return rows;
  }
}

export function attachHkAop(stores, versions, today) {
  return stores.map(store=>{
    const history=versions.filter(v=>v.retail_store_id===store.id && (v.aop_class==null || v.aop_class==='HK'));
    const current=history.filter(v=>!v.superseded_at && v.effective_from<=today && (!v.effective_to||v.effective_to>=today));
    const hk_aop=current.length===1?current[0].hk_count:null;
    return {...store,hk_aop,aop_conflict:current.length>1,aop_history:history.map(({effective_from,effective_to,hk_count,superseded_at})=>({effective_from,effective_to,hk_count,superseded_at}))};
  });
}

export async function readHkStoreMaster(client, access, requested) {
  const states=hkStoreStates(access,requested);
  const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  const stores=await readAll(()=>client.from('reliance_retail_store_operational_ownership')
    .select('id,store_code,store_name,state,city,store_format,status,zone_id,zone_name,current_responsible_fo_employee_code')
    .in('state',states).order('id'));
  const versions=[];
  for(let i=0;i<stores.length;i+=100){
    const ids=stores.slice(i,i+100).map(s=>s.id);
    versions.push(...await readAll(()=>client.from('retail_attendance_aop_versions')
      .select('id,retail_store_id,hk_count,aop_class,effective_from,effective_to,superseded_at')
      .in('retail_store_id',ids).or('aop_class.is.null,aop_class.eq.HK').order('id')));
  }
  return {states,as_of:today,rows:attachHkAop(stores,versions,today)};
}
