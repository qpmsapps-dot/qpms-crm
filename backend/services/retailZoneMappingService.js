import XLSX from 'xlsx';
import {validateExcelContainer} from './retailAttendanceService.js';
import {unifiedSnapshot,proposeZoneFromSnapshot} from './retailUnifiedService.js';
import {previewZoneMappings,ZONE_MAPPING_HEADERS} from '../shared/retailZoneMapping.js';
export function parseZoneMappingWorkbook(bytes,name){
 validateExcelContainer(bytes,name);const book=XLSX.read(bytes,{type:'buffer',cellFormula:true}),sheet=book.Sheets['Zone Mapping'];if(!sheet?.['!ref'])throw Object.assign(Error('Zone Mapping worksheet required.'),{statusCode:400});
 const range=XLSX.utils.decode_range(sheet['!ref']);if(range.e.r>1000||range.e.c>30)throw Object.assign(Error('Mapping workbook supports up to 1000 source rows.'),{statusCode:400});
 const grid=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}),headers=grid[0];for(const h of ZONE_MAPPING_HEADERS)if(headers.filter(v=>v===h).length!==1)throw Object.assign(Error('Missing or duplicate mapping header: '+h),{statusCode:400});
 return grid.slice(1).flatMap((cells,i)=>{if(!cells.some(v=>String(v).trim()))return [];const issues=[];for(let c=0;c<headers.length;c++){const cell=sheet[XLSX.utils.encode_cell({r:i+1,c})];if(cell?.f||cell?.t==='e')issues.push('TECHNICAL_FORMULA_OR_CELL_ERROR');}return [{...Object.fromEntries(headers.map((h,c)=>[h,cells[c]??''])),_source_row:i+2,_technical_issues:issues}];});
}
export const previewZoneWorkbook=async(c,p,bytes,name)=>previewZoneMappings(parseZoneMappingWorkbook(bytes,name),await unifiedSnapshot(c,p));
export async function submitZoneRecords(client,profile,records,stamp){
 if(!Array.isArray(records)||records.length>1000)throw Object.assign(Error('One to 1000 mapping rows required.'),{statusCode:400});
 const snapshot=await unifiedSnapshot(client,profile),preview=previewZoneMappings(records,snapshot);
 if(stamp!==snapshot.stamp)throw Object.assign(Error('Mapping baseline changed; preview again.'),{statusCode:409});
 if(!preview.can_submit)throw Object.assign(Error('Resolve mapping conflicts before submission. No proposals were saved.'),{statusCode:409});
 if(preview.rows.some(r=>r.disposition==='PROVISIONAL_DRAFT')){const {error}=await client.rpc('rpc_retail_zone_drafts',{p_actor:profile.id});if(error)throw error;}
 const receipt={source_rows:records.length,created_proposals:[],drafts:[],unchanged:0,existing_proposals:[],failed_rows:[],operational_writes:0};
 for(const row of preview.rows){
  if(row.disposition==='UNCHANGED'){receipt.unchanged++;continue;}
  if(row.disposition==='EXISTING_REVIEW_PROPOSAL'){receipt.existing_proposals.push(row.existing_proposal_id);continue;}
  try{
   if(row.type==='PROVISIONAL_DRAFT'){
    const {data,error}=await client.rpc('rpc_retail_zone_draft_save',{p_actor:profile.id,p_row:row.row_id,p_revision:row.revision,p_zone:row.zone_id,p_effective_from:row.changes.effective_from,p_effective_to:row.changes.effective_to||null,p_reason:row.reason});if(error)throw error;receipt.drafts.push(data);
   }else receipt.created_proposals.push(await proposeZoneFromSnapshot(client,profile,{kind:row.kind,state:row.state,store_id:row.store_id,zone_id:row.type==='ZONE_FO'?row.zone_id:null,changes:row.changes,reason:row.reason},snapshot));
  }catch(error){receipt.failed_rows.push({source_row:row.source_row,message:error.code==='42501'?'Editor scope changed.':error.code==='40001'?'Mapping source changed; preview again.':'Proposal could not be saved; re-preview before retrying.'});break;}
 }
 return {...receipt,partial:receipt.failed_rows.length>0,not_attempted:receipt.failed_rows.length?records.length-(receipt.created_proposals.length+receipt.drafts.length+receipt.unchanged+receipt.existing_proposals.length+receipt.failed_rows.length):0};
}
