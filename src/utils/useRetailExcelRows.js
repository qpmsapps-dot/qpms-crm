import {useEffect,useState} from 'react';
import {authenticatedApiRequest} from '../services/api.js';
import {useAuth} from '../context/auth-context.js';
import {isPlatformAdmin} from './authRoles.js';

// Fetch all pages, but only within the already approved admin-only, read-only
// Excel history API. NEVER write these rows to the operational tables.
export function useRetailExcelRows(module,enabled=true,month='2026-10'){
 const {user}=useAuth();
 const canRead=isPlatformAdmin(user)&&enabled&&month==='2026-10';
 const [value,setValue]=useState({rows:[],loading:false,error:'',key:''});
 useEffect(()=>{
  if(!canRead)return;
  let live=true;
  const key=module+':'+month;
  queueMicrotask(()=>{if(live)setValue({rows:[],loading:true,error:'',key});});
  async function load(){
   try{
    const size=500;
    let page=1,all=[],total=0;
    do{
     const {data}=await authenticatedApiRequest({
      url:'/api/reliance-retail/module-reports/ifms-history',
      params:{module,month,page,limit:size}
     });
     const result=data?.report;
     if(!Array.isArray(result?.rows)||!Number.isFinite(Number(result?.total)))
      throw Error('October Excel source API returned an incomplete report.');
     total=Number(result.total);
     all.push(...result.rows);
     if(all.length>=total)break;
     if(!result.rows.length||page>=10)throw Error('October Excel source pages were incomplete.');
     page++;
    }while(page<=10);
    if(live)setValue({rows:all,loading:false,error:'',key});
   }catch(error){
    if(live)setValue({rows:[],loading:false,error:error.response?.data?.message||error.message,key});
   }
  }
  void load();
  return()=>{live=false;};
 },[canRead,module,month]);
 if(!canRead)return {rows:[],loading:false,error:''};
 if(value.key!==module+':'+month)return {rows:[],loading:true,error:''};
 return value;
}
