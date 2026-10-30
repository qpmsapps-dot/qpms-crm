import XLSX from 'xlsx';
import {createHash} from 'node:crypto';
import {validateExcelContainer} from './retailAttendanceService.js';
import {reportingState,storeKey,indiaToday,validDate} from '../shared/retailAttendance.js';
import {UNIFIED_HEADERS} from '../shared/retailUnifiedColumns.js';
import {classifyUnifiedRow,IMPORT_CLASSIFICATIONS,sourceNoteIssues} from '../shared/retailUnifiedClassification.js';
export {UNIFIED_HEADERS};
const hash=v=>createHash('sha256').update(v).digest('hex');
const text=v=>String(v??'').trim();
const state=v=>{const k=storeKey(v);return ({KN:'KA',KARNATAKA:'KA',KERALA:'KL','TAMIL NADU':'TN',PUDUCHERRY:'PY',PONDICHERRY:'PY',TELANGANA:'TG'})[k]||k;};
export function parseUnifiedMaster(bytes,filename){
 validateExcelContainer(bytes,filename);const book=XLSX.read(bytes,{type:'buffer',cellFormula:true});
 const sheet=book.Sheets['STORE UPLOAD REVIEW']?'STORE UPLOAD REVIEW':book.Sheets['UNIFIED MASTER']?'UNIFIED MASTER':book.Sheets['CONSOLIDATED MASTER']?'CONSOLIDATED MASTER':null;
 if(!sheet)throw Object.assign(Error('Expected STORE UPLOAD REVIEW, UNIFIED MASTER or CONSOLIDATED MASTER worksheet.'),{statusCode:400});
 const sheets={};let cellCount=0;for(const name of book.SheetNames){const s=book.Sheets[name];if(!s['!ref']){sheets[name]=[];continue;}const range=XLSX.utils.decode_range(s['!ref']);if(range.e.r>10000||range.e.c>120||(cellCount+=(range.e.r+1)*(range.e.c+1))>1500000)throw Object.assign(Error('Workbook exceeds supported row/column limits.'),{statusCode:400});sheets[name]=XLSX.utils.sheet_to_json(s,{header:1,defval:'',blankrows:true});}
 const grid=sheets[sheet],headers=grid[0].map(text);if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)throw Object.assign(Error('Duplicate column headers.'),{statusCode:400});
 if(!headers.includes('Site Code')&&!headers.includes('Store Code'))throw Object.assign(Error('Store Code / Site Code column required.'),{statusCode:400});
 const exceptionGrid=sheets.EXCEPTIONS||[],exceptionHeaders=(exceptionGrid[0]||[]).map(text);
 const exceptions=exceptionGrid.slice(1).map((values,i)=>({sheet_row:i+2,...Object.fromEntries(exceptionHeaders.map((h,c)=>[h,values[c]]))}));
 const rows=[];
 for(let r=1;r<grid.length;r++){
  if(grid[r].every(v=>v===''))continue;
  const raw={},cells={},issues=[];
  headers.forEach((h,c)=>{const cell=book.Sheets[sheet][XLSX.utils.encode_cell({r,c})];if(!h)return;raw[h]=grid[r][c]??'';if(cell){cells[h]={value:cell.v??null,type:cell.t,formula:cell.f??null,format:cell.z??null};if(cell.f||cell.t==='e')issues.push('TECHNICAL_FORMULA_OR_CELL_ERROR');}});
  const get=(...keys)=>{const k=keys.find(k=>Object.hasOwn(raw,k));return k?raw[k]:null;};
  const number=(...keys)=>{const v=get(...keys);if(v==null||text(v)==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0){issues.push('INVALID_AOP_COMPONENT');return null;}return n;};
  const date=(...keys)=>{const v=get(...keys);if(v==null||v==='')return null;if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v,{date1904:!!book.Workbook?.WBProps?.date1904});return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:null;}return text(v);};
  const codeCell=book.Sheets[sheet][XLSX.utils.encode_cell({r,c:headers.indexOf(headers.includes('Site Code')?'Site Code':'Store Code')})];
  const store_code=storeKey(codeCell?.t==='n'?XLSX.utils.format_cell(codeCell):get('Site Code','Store Code'));
  const geography=state(get('Geographic State')),budgetFrom=date('Budget Start'),budgetTo=date('Budget End');
  const review={store_name:text(get('Store Name','Store Name / Location','Store Name (Source)')),state:geography,reporting_state:reportingState(geography),store_format:text(get('Store Format','Format')),city:text(get('City','City / Location')),area:text(get('Area / Locality')),district:text(get('District')),address:text(get('Address')),pincode:text(get('Pincode')),operating_status:text(get('Operating Status','Store Operating Status (Source)'))||'UNKNOWN',opening_date:date('Opening Date'),closing_date:date('Closing Date'),
   zone:{id:text(get('Zone ID'))||null,name:text(get('Zone Name','Operational Zone (Proposed)')),state:state(get('Zone State'))||geography,status:text(get('Zone Status'))||'UNKNOWN',effective_from:date('Zone Effective From'),effective_to:date('Zone Effective To'),verification:'PENDING_VERIFICATION'},
   location_evidence:{latitude:get('Latitude (Source)'),longitude:get('Longitude (Source)'),verification:'PENDING_VERIFICATION'},
   fo_evidence:{employee_code:text(get('FO Employee ID (Source)','FO Employee ID (Verified)')),name:text(get('FO Name (Source)','Primary FO Name (Source)')),contact:text(get('FO Contact (Source)','FO Phone (Source)')),effective_from:date('FO Effective From'),effective_to:date('FO Effective To'),verification:'PENDING_VERIFICATION',supervisor:text(get('Technical / MEPC Supervisor')),afm:text(get('AFM Name (Source)')),reference:text(get('FO Mapping Evidence'))},
   hk:{staff:number('HK Staff','HK AOP - Staff'),supervisor:number('HK Supervisor','HK AOP - Supervisor'),total:number('HK Total (Proposed)','HK AOP - Total (Source)'),effective_from:date('HK Effective From')||budgetFrom,effective_to:date('HK Effective To')||budgetTo,approval_ref:text(get('HK Approval Ref')),calculation_ref:text(get('HK Calculation Ref')),verification:'PENDING_VERIFICATION'},
   mepc:{shared:number('MEPC Shared','MEPC AOP - Shared'),supervisor:number('MEPC Supervisor','MEPC AOP - Supervisor'),stationed:number('MEPC Stationed','MEPC AOP - Stationed'),total:number('MEPC Total (Proposed)','MEPC AOP - Total (Source)'),effective_from:date('MEPC Effective From')||budgetFrom,effective_to:date('MEPC Effective To')||budgetTo,approval_ref:text(get('MEPC Approval Ref')),calculation_ref:text(get('MEPC Calculation Ref')),verification:'PENDING_VERIFICATION'},mis_remarks:text(get('MIS Remarks','Reviewer Notes','MIS Correction Remarks'))};
  if(!store_code)issues.push('MISSING_STORE_CODE');if(/[\s/,;|]/.test(store_code))issues.push('AMBIGUOUS_STORE_CODE');if(!['TN','PY','KA','KL','TG','AP-1','AP-2'].includes(geography))issues.push('UNKNOWN_GEOGRAPHY');
  if(!review.store_name)issues.push('MISSING_STORE_NAME');if(!review.zone.id)issues.push('ZONE_PENDING');if(!review.fo_evidence.employee_code)issues.push('FO_IDENTITY_UNVERIFIED');
  if(get('Reporting State')&&reportingState(get('Reporting State'))!==review.reporting_state)issues.push('REPORTING_STATE_MISMATCH');
  for(const kind of ['hk','mepc']){const a=review[kind];if(a.total===null)issues.push(`${kind.toUpperCase()}_TOTAL_PENDING`);for(const d of [a.effective_from,a.effective_to].filter(Boolean)){try{validDate(d);}catch{issues.push('INVALID_BUDGET_DATE');}}if(a.effective_to&&a.effective_to<indiaToday())issues.push('EXPIRED_BUDGET');}
  issues.push(...sourceNoteIssues(raw));
  const source_exceptions=exceptions.filter(e=>storeKey(e['Site Code'])===store_code&&(!e.State||state(e.State)===geography));if(source_exceptions.length)issues.push('EXCEPTION_SHEET_REVIEW');
  rows.push({source_row:r+1,row_digest:hash(JSON.stringify(cells)),raw,raw_cells:cells,source_sheet:sheet,source_reference:text(get('Source Sheet Row','Master Source Row')),source_exceptions,store_code,state:geography,store_name:review.store_name,city:review.city,review,issues:[...new Set(issues)]});
 }
 if(!rows.length)throw Object.assign(Error('No source rows.'),{statusCode:400});
 const sheet_checks=(sheets['STATE COUNTS']||[]).slice(1).map(values=>({state:state(values[0]),declared_rows:values[1],actual_rows:rows.filter(r=>r.state===state(values[0])).length}));
 return {checksum:hash(bytes),filename,format:sheet,sheets,rows,sheet_checks};
}
export function previewUnifiedMaster(parsed,snapshot){
 const groups=new Map();for(const row of parsed.rows)groups.set(row.store_code,(groups.get(row.store_code)||0)+1);
 const rows=parsed.rows.map(r=>{const canonical=snapshot.stores.find(s=>storeKey(s.store_code)===r.store_code);const previous=snapshot.rows.filter(s=>s.store_code===r.store_code&&!s.withdrawn_at);const issues=[...r.issues];if(groups.get(r.store_code)>1)issues.push('DUPLICATE_SOURCE_CODE');if(canonical&&canonical.state!==r.state)issues.push('CANONICAL_GEOGRAPHY_CONFLICT');if(canonical&&storeKey(canonical.store_name)!==storeKey(r.store_name))issues.push('CANONICAL_NAME_CONFLICT');if(r.review.fo_evidence.employee_code&&!snapshot.fos.some(f=>storeKey(f.employee_code)===storeKey(r.review.fo_evidence.employee_code)))issues.push('FO_IDENTITY_UNVERIFIED');return {...r,canonical_id:canonical?.id||null,previous_rows:previous.length,match_type:canonical?'MATCHED_CANONICAL':previous.length?'MATCHED_PROVISIONAL':'NEW_CANDIDATE',...classifyUnifiedRow({...r,issues})};});
 const classification_counts=Object.fromEntries(IMPORT_CLASSIFICATIONS.map(label=>[label,rows.filter(r=>r.classification===label).length]));
 const pending_fields={};for(const row of rows)for(const issue of row.pending_issues)pending_fields[issue]=(pending_fields[issue]||0)+1;
 const recorded=snapshot.files?.find(f=>f.sha256===parsed.checksum);
 const conflicts=rows.filter(r=>r.actual_conflict_issues.length).length;
 return {...parsed,rows,stamp:snapshot.stamp,receipt:{source_rows:rows.length,inserted:0,staged_rows:recorded?0:rows.length,matched:rows.filter(r=>r.match_type!=='NEW_CANDIDATE').length,canonical_matches:rows.filter(r=>r.match_type==='MATCHED_CANONICAL').length,provisional_matches:rows.filter(r=>r.match_type==='MATCHED_PROVISIONAL').length,new_candidates:rows.filter(r=>r.match_type==='NEW_CANDIDATE').length,proposed_updates:0,unchanged:recorded?rows.length:0,is_replay:!!recorded,pending_fields_rows:rows.filter(r=>r.pending_issues.length).length,pending_field_flags:rows.reduce((n,r)=>n+r.pending_issues.length,0),pending_fields,conflicts,actual_conflict_rows:conflicts,blocking_identity_rows:classification_counts['Blocking Identity Conflict'],needs_review_rows:classification_counts['Needs Review'],ready_for_staging_rows:classification_counts['Ready for Staging'],classification_counts,rejected_technical_rows:rows.filter(r=>r.technical_issues.length).length,operational_writes:0},can_save:rows.every(r=>snapshot.permissions.some(p=>p.state===r.state&&['editor','reviewer','admin'].includes(p.permission))||snapshot.admin)};
}
