import XLSX from 'xlsx';
import {validateExcelContainer} from './retailAttendanceService.js';
import {misRpc} from './retailMisService.js';
export const CLEANING_PLAN_HEADERS=['STATE','STORE_CODE','SCHEDULE_DATE','FO_EMPLOYEE_CODE','REMARKS'];
const invalid=message=>Object.assign(Error(message),{statusCode:400});
export function parseCleaningPlan(bytes,filename){
 validateExcelContainer(bytes,filename);
 const book=XLSX.read(bytes,{type:'buffer',cellDates:false});
 if(book.SheetNames.length!==1)throw invalid('Use one worksheet per monthly import.');
 const matrix=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:true,defval:''});
 const headers=(matrix.shift()||[]).map(v=>String(v).trim().toUpperCase().replace(/[\s-]+/g,'_'));
 if(new Set(headers).size!==headers.length||headers.some(h=>!CLEANING_PLAN_HEADERS.includes(h))||CLEANING_PLAN_HEADERS.slice(0,4).some(h=>!headers.includes(h)))throw invalid('Required unique headers: STATE, STORE_CODE, SCHEDULE_DATE, FO_EMPLOYEE_CODE; optional REMARKS.');
 if(!matrix.length||matrix.length>500)throw invalid('Supply 1-500 rows. Blank rows must be removed explicitly.');
 return matrix.map(cells=>Object.fromEntries(headers.map((h,i)=>{
  let value=cells[i]??'';
  if(h==='SCHEDULE_DATE'&&typeof value==='number'){
   const d=XLSX.SSF.parse_date_code(value,{date1904:book.Workbook?.WBProps?.date1904});
   value=d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:String(value);
  }
  return [h,String(value).trim()];
 })));
}
export function cleaningPlanCommand(client,profile,action,data){
 return misRpc(client,'rpc_retail_cleaning_plan_v1',{p_actor:profile.id,p_auth:profile.auth_user_id,p_action:action,p_data:data});
}
