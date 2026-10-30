import XLSX from 'xlsx';
import {createHash} from 'node:crypto';
import {validateExcelContainer} from './retailAttendanceService.js';
import {storeKey} from '../shared/retailAttendance.js';
export const QUOTATION_HEADERS=['Quotation Number','Store Code','Description','Quantity','Unit Rate'];
export function parseQuotation(bytes,filename,stores){
 validateExcelContainer(bytes,filename);const book=XLSX.read(bytes,{type:'buffer',cellFormula:true}),sheet=book.Sheets['Quotation'];if(!sheet?.['!ref'])throw Error('Quotation sheet is required.');
 const range=XLSX.utils.decode_range(sheet['!ref']);if(range.e.r>10000||range.e.c>40)throw Error('Quotation exceeds supported limits.');
 const grid=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}),headers=grid[0];for(const h of QUOTATION_HEADERS)if(headers.filter(v=>v===h).length!==1)throw Error(`One ${h} column is required.`);
 const groups=new Map(),errors=[];for(let r=1;r<grid.length;r++){
  if(!grid[r].some(v=>String(v).trim()))continue;
  const raw=Object.fromEntries(headers.map((h,i)=>[h,grid[r][i]??''])),row={source_row:r+1,raw},issue=[];
  for(let c=0;c<headers.length;c++)if(sheet[XLSX.utils.encode_cell({r,c})]?.f||sheet[XLSX.utils.encode_cell({r,c})]?.t==='e')issue.push('Formula/error cell');
  const number=String(raw['Quotation Number']).trim(),code=storeKey(raw['Store Code']),candidates=stores.filter(s=>storeKey(s.store_code)===code&&s.status==='Active');
  const quantity=Number(raw.Quantity),rate=Number(raw['Unit Rate']);if(!number||!String(raw.Description).trim())issue.push('Quotation number and description required');
  if(candidates.length!==1)issue.push('One active verified canonical store required');
  if(raw.Quantity===''||raw['Unit Rate']===''||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(rate)||rate<0)issue.push('Valid quantity and unit rate required');
  if(issue.length){errors.push({...row,issues:issue});continue;}
  const store=candidates[0],key=number;const group=groups.get(key)||{quotation_number:number,state:store.state,store_ids:[],items:[]};
  if(group.state!==store.state){errors.push({...row,issues:['Cross-state quotation requires separate authorized review']});continue;}
  group.store_ids=[...new Set([...group.store_ids,store.id])].sort();group.items.push({...row,store_id:store.id,store_code:code,description:String(raw.Description).trim(),quantity,unit_rate:rate});groups.set(key,group);
 }
 return {filename,sha256:createHash('sha256').update(bytes).digest('hex'),original_base64:bytes.toString('base64'),source_rows:[...groups.values()].reduce((n,g)=>n+g.items.length,0)+errors.length,groups:[...groups.values()],errors,can_save:errors.length===0&&groups.size>0};
}
