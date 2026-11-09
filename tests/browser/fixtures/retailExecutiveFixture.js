export function fixture(from,to,{partial=false,empty=false}={}) {
  const states=['TN','KN','KL','AP-1','AP-2','TG'];
  const stores=empty?[]:states.flatMap((state,i)=>[0,1].map(n=>({id:`s${i}-${n}`,store_code:`SYN${i}${n}`,store_name:`Synthetic Store ${i}/${n}`,state})));
  const prior=from<'2026-11-01';
  const rows=fn=>empty?[]:states.map((state,i)=>({state,...fn(i)}));
  const modules={
    attendance:{status:'ready',rows:rows(i=>({hk_actual:18+i,hk_target:25,mepc_actual:8,mepc_target:10,total_actual:26+i,total_target:35,complete:!partial,missing_dates:partial?[from]:[],missing_aop:[]}))},
    cleaning:{status:'ready',rows:rows(()=>({scheduled:12,completed:prior?6:8,pending:prior?5:3,not_completed:1,remaining:prior?6:4})),identity_exceptions:0},
    soft:{status:'ready',rows:rows(()=>({completed:prior?1:2})),identity_exceptions:0},technical:{status:'ready',rows:rows(()=>({completed:1})),identity_exceptions:0},
    cm:{status:'ready',rows:rows(()=>({eligible:2,completed:prior?1:2,remaining:prior?1:0})),stores:stores.map(s=>({...s,completed:true,completed_on:to,completed_at:to+'T05:00:00Z'}))},
    pm:{status:'ready',rows:rows(()=>({eligible:2,completed:1,remaining:1})),stores:stores.map(s=>({...s,completed:false}))},
    thermography:{status:'ready',rows:rows(()=>({scheduled:3,awaiting:2,approved:prior?1:2,overdue:1,approved_late:0}))}
  };
  return {from,to,updated_at:to+'T08:00:00Z',stores,modules,historical_ifms:null};
}
export async function seed(page,{failure=false,partial=false,empty=false,denyPhoto=false,delay=0,role='Admin',business='Reliance Retail'}={}) {
 await page.addInitScript(({role,business})=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic',profileId:'synthetic',name:'Synthetic Executive',role,rawRole:role,business,status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-token');sessionStorage.setItem('qpms-retail-executive-v3',JSON.stringify({month:'2026-11',cutoff:'2026-11-09'}));},{role,business});
 const requests=[];
 await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());requests.push({path:u.pathname,params:Object.fromEntries(u.searchParams)});
   if(route.request().method()!=='GET')throw Error('No operational writes permitted');
   if(u.pathname.endsWith('/module-reports/dashboard')){if(delay)await new Promise(r=>setTimeout(r,delay));return route.fulfill(failure?{status:503,json:{message:'Synthetic source unavailable'}}:{json:{report:fixture(u.searchParams.get('from'),u.searchParams.get('to'),{partial,empty})}});}
   if(u.pathname.endsWith('/attendance/summary')){const cutoff=u.searchParams.get('cutoff')||'2026-11-09';const baseline=fixture(cutoff.slice(0,7)+'-01',cutoff,{partial,empty}).modules.attendance.rows;return route.fulfill({json:{report:{cutoff,states:baseline,stores:[],total:{state:'Total',hk_actual:0,mepc_actual:0,total_actual:0,total_target:0,complete:false,hk_aop:0,mepc_aop:0,total_aop:0,hk_target:0,mepc_target:0,missing_dates:[],missing_aop:[],overall_pct:null,hk_pct:null,mepc_pct:null},available_states:['TN'],can_upload:false,latest_imported_date:cutoff,trend:Array.from({length:Number(cutoff.slice(8))},(_,i)=>({date:cutoff.slice(0,8)+String(i+1).padStart(2,'0'),complete:!partial&&i!==2,has_attendance_upload:i!==2,overall_pct:partial||i===2?null:75+i,hk_pct:partial||i===2?null:70+i,mepc_pct:partial||i===2?null:90+i}))}}});}
   if(u.pathname.endsWith('/view-url'))return route.fulfill(denyPhoto?{status:403,json:{message:'Synthetic evidence denied'}}:{json:{view:{url:'https://evidence.invalid/synthetic.jpg'}}});
   if(u.pathname==='/api/training/sessions')return route.fulfill({json:{sessions:empty?[]:[{id:'session',training_date:'2026-11-09',category:{code:'hk'},store:{id:'s0-0',store_code:'SYN00',store_name:'Synthetic Store 0/0',state:'TN'},status:'submitted',topic_count:1,attendee_count:5,evidence_count:1}]}});
   if(u.pathname.includes('/api/training/sessions/'))return route.fulfill({json:{session:{id:'session'},evidence:[{id:'e1',file_name:'Synthetic training photo',mime_type:'image/jpeg',evidence_type:'topic_photo'}]}});
   return route.fulfill({json:{}});
 });
 await page.route('https://evidence.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="330"><rect width="500" height="330" fill="#dce8ed"/><text x="50" y="165" fill="#4d6688">Synthetic authorized evidence fixture</text></svg>'}));
 return requests;
}
export async function revealAll(page){for(let n=0;n<45;n++){const atEnd=await page.evaluate(()=>{const end=scrollY+innerHeight>=document.documentElement.scrollHeight-4;scrollBy(0,innerHeight*.75);return end});await page.waitForTimeout(90);if(atEnd)break;}await page.waitForTimeout(700);}
