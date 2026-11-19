import XLSX from 'xlsx';
import {validateExcelContainer} from './retailAttendanceService.js';
import {misRpc} from './retailMisService.js';
export const CLEANING_PLAN_HEADERS=['STATE','STORE_CODE','SCHEDULE_DATE','REMARKS','FO_EMPLOYEE_CODE'];
const invalid=message=>Object.assign(Error(message),{statusCode:400});
export function parseCleaningPlan(bytes,filename){
 validateExcelContainer(bytes,filename);
 const book=XLSX.read(bytes,{type:'buffer',cellDates:false,cellNF:true});
 if(book.SheetNames.length!==1)throw invalid('Use one worksheet per monthly import.');
 const sheet=book.Sheets[book.SheetNames[0]];
 const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''});
 const headers=(matrix.shift()||[]).map(v=>String(v).trim().toUpperCase().replace(/[\s-]+/g,'_'));
 if(new Set(headers).size!==headers.length||headers.some(h=>!CLEANING_PLAN_HEADERS.includes(h))||CLEANING_PLAN_HEADERS.slice(0,3).some(h=>!headers.includes(h)))throw invalid('Required unique headers: STATE, STORE_CODE, SCHEDULE_DATE; optional REMARKS and legacy FO_EMPLOYEE_CODE.');
 if(!matrix.length||matrix.length>500)throw invalid('Supply 1-500 rows. Blank rows must be removed explicitly.');
 return matrix.map((cells,row)=>Object.fromEntries(headers.map((h,i)=>{
  let value=cells[i]??'';
  const cell=sheet[XLSX.utils.encode_cell({r:row+1,c:i})];
  if(cell?.f)throw invalid('Formula cells are not supported in schedule imports.');
  if(h==='STORE_CODE'&&cell?.t==='n'&&/^0+$/.test(cell.z||'General'))value=XLSX.utils.format_cell(cell);
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
export async function cleaningScheduleWriterAccess(client,profile,authUser){
 if(!profile?.id||!authUser?.id||profile.auth_user_id!==authUser.id)throw Object.assign(Error('Verified account required.'),{statusCode:401});
 const result=await misRpc(client,'rpc_retail_cleaning_writer_access_v2',{p_actor:profile.id,p_auth:authUser.id});
 const states=['TN','PY','KA','KL','TG','AP-1','AP-2'];
 if(result?.contract!=='cleaning-schedule-writer.v1'||result.role!=='CLEANING_SCHEDULE_WRITER'||!Array.isArray(result.states)||result.states.some(s=>!states.includes(s))||result.modules?.length!==1||result.modules[0]!=='cleaning')throw Object.assign(Error('Deep Cleaning writer capability unavailable.'),{statusCode:503});
 return {...result,active:result.active===true&&result.states.length>0,read_only:false,schedule_writer:true};
}
