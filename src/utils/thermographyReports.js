import {indiaToday,reportingState} from '../../backend/shared/retailAttendance.js';

export const THERMO_XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const THERMO_UPLOAD_LIMIT=100*1024*1024;
export function isCompleteThermoReport(data){
 return !!data&&data.status!=='unavailable'&&data.contract==='thermography-reports.v1'&&typeof data.scope_digest==='string'&&!!data.scope_digest
  &&Array.isArray(data.rows)&&data.rows.every(r=>r&&typeof r.id==='string'&&typeof r.retail_store_id==='string'&&typeof r.display_status==='string'&&typeof r.report_managed==='boolean'&&Number.isInteger(r.revision))
  &&Array.isArray(data.stores)&&data.stores.every(s=>s&&typeof s.id==='string'&&typeof s.store_code==='string'&&typeof s.state==='string')
  &&['scheduled','awaiting','rework','approved','active_reports'].every(k=>Number.isInteger(data.counts?.[k])&&data.counts[k]>=0)
  &&Number.isInteger(data.total)&&data.total>=data.rows.length&&Number.isInteger(data.page)&&data.page>=0&&Number.isInteger(data.limit)&&data.limit>0&&data.limit<=100
  &&Number.isInteger(data.max_bytes)&&data.max_bytes>0&&data.max_bytes<=THERMO_UPLOAD_LIMIT
  &&['can_upload','can_schedule','is_super'].every(k=>typeof data[k]==='boolean');
}
export function thermoMonthRange(month=indiaToday().slice(0,7)){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Select a valid month.');
 const [y,m]=month.split('-').map(Number);return {from:month+'-01',to:month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')};
}
export function validateThermoSelection(file,maxBytes=THERMO_UPLOAD_LIMIT){
 if(!file||!/\.xlsx$/i.test(file.name)||[...file.name].some(c=>c.charCodeAt(0)<32||['/','\\'].includes(c))||file.name.length>180)throw Error('Select an original .xlsx workbook.');
 if(file.size<22||file.size>maxBytes)throw Error(`Select a workbook up to ${Math.floor(maxBytes/1024/1024)} MiB.`);
 if(file.type&&!['application/zip','application/octet-stream',THERMO_XLSX_MIME].includes(file.type))throw Error('Only .xlsx Excel workbooks are supported.');
}
export async function thermoFileIdentity(file,maxBytes=THERMO_UPLOAD_LIMIT){
 validateThermoSelection(file,maxBytes);
 const bytes=await file.arrayBuffer();
 if(new DataView(bytes).getUint32(0,true)!==0x04034b50)throw Error('The selected file does not have an XLSX signature.');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export const thermoPendingKey=user=>`myqpms.thermography.upload.v1.${user}`;
export function readThermoPending(storage,user){try{const p=JSON.parse(storage.getItem(thermoPendingKey(user))||'null');return p?.payload?.request_id?p:null;}catch{return null;}}
export function saveThermoPending(storage,user,pending){storage.setItem(thermoPendingKey(user),JSON.stringify(pending));if(readThermoPending(storage,user)?.payload.request_id!==pending.payload.request_id)throw Error('Retry identity could not be retained. Enable session storage before uploading.');}
export function thermoOperation(storage,key,payload){
 const previous=JSON.parse(storage.getItem(key)||'null'),fingerprint=JSON.stringify(payload);
 if(previous?.fingerprint===fingerprint)return previous.request_id;
 const request_id=crypto.randomUUID();storage.setItem(key,JSON.stringify({fingerprint,request_id}));return request_id;
}
export function uploadThermoFile(url,file,onProgress=()=>{},Xhr=XMLHttpRequest){
 return new Promise((resolve,reject)=>{
  const xhr=new Xhr();xhr.open('PUT',url);xhr.timeout=120000;xhr.setRequestHeader('Content-Type',THERMO_XLSX_MIME);xhr.setRequestHeader('x-upsert','false');
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
  xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('Upload was not confirmed. Retry with the same workbook and request identity.'));
  xhr.onerror=xhr.ontimeout=()=>reject(Error('Upload interrupted. The previous active report is unchanged; retry the same upload.'));xhr.send(file);
 });
}
export async function loadThermoExport(request,filter){
 const first=await request({...filter,page:0,limit:100});
 if(first.contract!=='thermography-reports.v1'||!Array.isArray(first.rows)||!first.scope_digest)throw Error('Complete authorized report unavailable.');
 if(first.total>5000)throw Error('More than 5,000 records match. Narrow the report dates or filters.');
 const rows=[...first.rows];
 for(let page=1;rows.length<first.total;page++){
  const next=await request({...filter,page,limit:100});
  if(next.scope_digest!==first.scope_digest||next.total!==first.total||!next.rows?.length)throw Error('Records changed while exporting. Refresh and retry; no partial export was downloaded.');
  rows.push(...next.rows);
 }
 if(rows.length!==first.total||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Report pagination did not reconcile. Refresh before exporting.');
 return {...first,rows};
}
export async function buildThermoSummary(data,filter){
 const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();book.creator='myQPMS';book.title='Reliance Retail Thermography report summary';
 const value=x=>x==null||x===''?'Not recorded':x;
 const date=x=>x&&!Number.isNaN(Date.parse(x))?new Date(x):'Not recorded';
 const summary=book.addWorksheet('Summary');summary.addRows([['Scope','Value'],['From',date(filter.from)],['To',date(filter.to)],['State',filter.state||'All authorized states'],['Store',filter.store||'All authorized stores'],['Status',filter.status||'All'],['Search',filter.q||''],['Deleted view',filter.deleted?'Yes; excluded from active KPIs':'No'],['Matching records',data.total],...Object.entries(data.counts),['Reporting basis','Inspection date / period start. Legacy status-only records remain explicitly identified.'],['Workbook note','Original workbooks are downloaded separately. This summary does not parse or classify thermal readings.']]);
 const groups=new Map();
 for(const r of data.rows){const state=reportingState(r.state),key=state+'|'+r.retail_store_id,g=groups.get(key)||{state,store_code:r.store_code,store_name:r.store_name,scheduled:0,awaiting:0,rework:0,approved:0,active:0,legacy:0};
  if(!r.report_deleted_at){g.scheduled+=r.display_status==='Scheduled'?1:0;g.awaiting+=r.report_review_state==='awaiting'?1:0;g.rework+=r.report_review_state==='rework'?1:0;g.approved+=r.active_version_id&&r.status==='Client Approved'?1:0;g.active+=r.active_version_id?1:0;g.legacy+=r.report_managed===false&&r.status!=='Scheduled'?1:0;}groups.set(key,g);
 }
 const stateGroups=new Map(),fields=['scheduled','awaiting','rework','approved','active','legacy'];
 for(const g of groups.values()){const s=stateGroups.get(g.state)||{state:g.state,...Object.fromEntries(fields.map(k=>[k,0]))};for(const k of fields)s[k]+=g[k];stateGroups.set(g.state,s);}
 const labels=['Scheduled','Awaiting Client Approval','Rework Required','Client Approved Reports','Active Workbooks','Legacy Status Records'];
 const states=book.addWorksheet('State summary');states.addRow(['Reporting State',...labels]);for(const g of stateGroups.values())states.addRow([g.state==='KN'?'KA':g.state,...fields.map(k=>g[k])]);
 const stores=book.addWorksheet('Store summary');stores.addRow(['Reporting State','Store Code','Store Name',...labels]);for(const g of groups.values())stores.addRow([g.state==='KN'?'KA':g.state,g.store_code,g.store_name,...fields.map(k=>g[k])]);
 const detail=book.addWorksheet('Report details');detail.addRow(['Inspection ID','State','Store Code','Store Name','Inspection Date / Period Start','Period End','Report Status','Current Version','Rework Count','Filename','Bytes','Uploaded By','Uploaded Date (UTC)','Approved By','Approval Date (UTC)','Approval Due','Report Upload','Deleted Date (UTC)']);
 for(const r of data.rows)detail.addRow([r.id,value(r.state),value(r.store_code),value(r.store_name),date(r.report_date||r.scheduled_date),date(r.report_period_end),r.display_status,value(r.version_number),r.report_rework_count||0,value(r.filename),value(r.file_size),value(r.uploaded_by_name||r.uploaded_by),date(r.uploaded_at),value(r.approved_by_name||r.approved_by),date(r.approved_at),date(r.approval_due_on),r.active_version_id?'Confirmed original workbook':'No uploaded workbook recorded',date(r.report_deleted_at)]);
 for(const s of book.worksheets){s.views=[{state:'frozen',ySplit:1}];s.columns.forEach(c=>{c.width=29;});s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF185AA6'}};s.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'};row.eachCell(c=>{if(c.value instanceof Date)c.numFmt=String(s.getRow(1).getCell(c.col).value).includes('(UTC)')?'yyyy-mm-dd hh:mm':'yyyy-mm-dd';});row.height=34;});}
 return book;
}
