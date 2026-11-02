import {stageLabel,matrix,OOS12} from '../pages/reliance-retail/retailOosModel.js';
export const REGISTER_HEADERS=['S.No','Quotation No','Quotation Date','State','Store Code(s)','Store Name','Quotation Amount','PO Number','Current Status','Quotation Ageing','PO Ageing','Status Ageing','Rework','Updated At','Warnings'];
// Literal text cells only; prefix characters interpreted as formulas by spreadsheet apps.
export const excelText=value=>{const s=String(value??'');return /^[\s]*[=+\-@]/.test(s)?"'"+s:s;};
export async function buildOosExport(rows,filters,states,now=new Date()) {
 const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();
 book.creator='myQPMS';book.created=now;
 const register=book.addWorksheet('Quotation register');register.addRow(REGISTER_HEADERS);
 for(const [i,r] of rows.entries())register.addRow([i+1,excelText(r.reference),r.quotation_date||'Unavailable',excelText(r.state||'Unresolved'),excelText(r.store_codes.join(', ')),excelText(r.store_names.join(', ')),r.amount,excelText(r.po_number),excelText(r.retired?'Retired':stageLabel(r.status)),r.quotation_age,r.po_age,r.status_age,r.rework_count??0,r.updated_at||'',excelText(r.warnings.join(' '))]);
 for(const c of [2,5,8])register.getColumn(c).numFmt='@';
 const items=book.addWorksheet('Line items');items.addRow(['Quotation','Store Code','Description','Quantity','Unit Rate','Total','Source']);
 for(const r of rows)for(const item of r.details?.items||[])items.addRow([excelText(r.reference),excelText(r.mapped_stores?.find(s=>s.id===item.store_id)?.store_code||'Unavailable'),excelText(item.description),item.quantity??null,item.unit_rate??null,item.total_amount??null,'Current revision']);
 const history=book.addWorksheet('Status and rework history');history.addRow(['Quotation','Action','From','To','Actor','Timestamp','Revision','Workbook retained']);
 for(const r of rows)for(const e of r.history||[])history.addRow([excelText(r.reference),excelText(e.action),excelText(e.from_status),excelText(e.to_status),excelText(e.actor_id),e.created_at,e.revision,e.has_workbook?'Yes':'No']);
 const summary=book.addWorksheet('Status ageing summary');summary.addRow(['Status','State','Quotations','Average status days','Maximum status days','Over 7 days','Unknown status dates']);
 const stages=[...OOS12,...[...new Set(rows.filter(r=>!OOS12.some(s=>s[0]===r.status)).map(r=>r.status))].map(s=>[s,stageLabel(s)])];
 for(const row of matrix(rows,states,stages).cells)for(const state of states){const c=row.states[state];summary.addRow([row.label,state,c.count,c.average,c.max,c.overdue,c.unknown]);}
 const meta=book.addWorksheet('Export information');meta.addRows([['Exported at UTC',now.toISOString()],['Business timezone','Asia/Kolkata'],['Ageing as of',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(now)],['Month rule','Original quotation business date; missing dates excluded from dated filters. All-Time includes missing dates.'],['Filters',excelText(JSON.stringify(filters))],['Authorized states',states.join(', ')],['Records',rows.length],['Matrix rule','Single verified canonical state per quotation. Retired/unresolved/cross-state rows excluded. No line-item duplication.'],['Overdue threshold','Current-status age > 7 days; monitoring only'],['Date provenance','Original CREATE_OOS and PO_RECORDED immutable events; current-status change event. Never updated_at.']]);
 for(const sheet of book.worksheets){sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1749B5'}};sheet.columns.forEach(c=>{c.width=24;});sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};}
 return book;
}
