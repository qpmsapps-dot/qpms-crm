import ExcelJS from 'exceljs';
import {ZONE_MAPPING_HEADERS,zoneStateSummary,currentZoneFo} from '../../backend/shared/retailZoneMapping.js';
export function buildZoneMappingExport(snapshot,state='',preview=null){
 const book=new ExcelJS.Workbook();
 const zoneCode=id=>id?(snapshot.zones.find(z=>z.id===id)?.zone_code||'MAPPING_OUTSIDE_VISIBLE_SCOPE'):'UNASSIGNED';
 const add=(name,headers,rows)=>{const sheet=book.addWorksheet(name);sheet.addRow(headers);for(const row of rows)sheet.addRow(headers.map(h=>row[h]??''));sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=25;});sheet.autoFilter={from:'A1',to:{row:Math.max(1,rows.length+1),column:headers.length}};return sheet;};
 const mapping=[];for(const s of snapshot.stores.filter(s=>!state||s.state===state))mapping.push({'Record Type':'STORE','State / Business Group':s.state,'Store Code':s.store_code,'Zone Code':zoneCode(s.ownership?.zone_id),'Effective From':'ON_ACTIVATION'});
 for(const zone of snapshot.zones.filter(z=>!state||z.state===state)){const f=currentZoneFo(snapshot,zone.id);mapping.push({'Record Type':'ZONE_FO','State / Business Group':zone.state,'Zone Code':zone.zone_code,'FO Employee Code':f?.fo_employee_code||(f?'ACCOUNT_REVIEW_REQUIRED':'UNASSIGNED'),'Effective From':'ON_ACTIVATION'});}
 add('Zone Mapping',ZONE_MAPPING_HEADERS,preview?preview.rows.map(r=>r.raw):mapping);
 if(preview)add('Conflict Preview',['Source row','Disposition','Issues','Warnings'],preview.rows.map(r=>({'Source row':r.source_row,Disposition:r.disposition,Issues:r.issues.join('; '),Warnings:r.warnings.join('; ')})));
 const counts=zoneStateSummary(snapshot).filter(r=>!state||r.state===state);add('State Counts',Object.keys(counts[0]||{state:0}),counts);
 add('Provisional Drafts',ZONE_MAPPING_HEADERS,snapshot.rows.filter(r=>!r.withdrawn_at&&(!state||r.source_state===state)&&!snapshot.stores.some(s=>s.store_code===r.store_code)).map(r=>({'Record Type':'PROVISIONAL_DRAFT','State / Business Group':r.source_state,'Store Code':r.store_code,'Source Row ID':r.id,'Effective From':'ON_ACTIVATION'})));
 const zoneIds=new Set(snapshot.zones.filter(z=>!state||z.state===state).map(z=>z.id));
 add('FO Ownership History',['Zone code','FO Employee Code','Effective From','Effective To','Status'],snapshot.assignments.filter(a=>zoneIds.has(a.zone_id)).map(a=>({'Zone code':snapshot.zones.find(z=>z.id===a.zone_id)?.zone_code,'FO Employee Code':a.fo_employee_code,'Effective From':a.effective_from,'Effective To':a.effective_to,Status:a.status})));
 add('Store Zone History',['Store Code','Previous Zone','New Zone','Effective At','Reason'],snapshot.store_zone_history.filter(h=>snapshot.stores.some(s=>s.id===h.retail_store_id&&(!state||s.state===state))).map(h=>({'Store Code':snapshot.stores.find(s=>s.id===h.retail_store_id)?.store_code,'Previous Zone':zoneCode(h.previous_zone_id),'New Zone':zoneCode(h.new_zone_id),'Effective At':h.changed_at,Reason:h.reason})));
 add('READ ME',['Instructions'],[
  {Instructions:'Zone Mapping is the import worksheet. Fill an explicit reason for each proposed change. Imports create review proposals, never approvals or activation.'},
  {Instructions:'STORE requires an identity-verified canonical Store Code. Zone Code must already exist in the same geography; UNASSIGNED explicitly removes a mapping. Blank is not removal.'},
  {Instructions:'ZONE_FO assigns one verified scoped employee account to a Zone, never to individual stores. UNASSIGNED explicitly removes the primary FO.'},
  {Instructions:'PROVISIONAL_DRAFT requires exact Source Row ID and Store Code. Copy chosen rows from Provisional Drafts, fill an existing same-state Zone and evidence reason. Drafts remain non-operational.'},
  {Instructions:'Effective timestamps must include timezone (for example YYYY-MM-DDTHH:mm:ss+05:30), or use ON_ACTIVATION for the start. End is optional. Never invent missing names or ownership.'},
  {Instructions:'PY remains geographic PY and reports under TN. Existing shared TN/PY mappings can be retained unchanged, but new Store-to-Zone assignments must stay within geography.'},
  {Instructions:'One to 1000 mapping rows per import. Every source version is retained; choose exact provisional row IDs. Operational review and authorized activation remain separate.'}
 ]);book.getWorksheet('READ ME').getColumn(1).width=120;return book;
}
