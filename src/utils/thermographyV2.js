export const PDF_MIME='application/pdf';
export const PDF_MAX_BYTES=10_000_000;
export function isThermographyV2Dashboard(r){
 const count=n=>Number.isSafeInteger(n)&&n>=0;
 if(r?.contract!=='thermography.v2'||!/^\d{4}-\d{2}-\d{2}$/.test(r.today||'')||!r.scope_digest||!Array.isArray(r.rows)||!Array.isArray(r.stores)||!Array.isArray(r.chart))return false;
 if(![r.summary?.scheduled,r.summary?.completed,r.monthly?.total,r.monthly?.completed,r.monthly?.scheduled,r.total].every(count)||!Number.isFinite(r.summary.percentage))return false;
 if(r.summary.completed>r.monthly.completed||r.summary.scheduled>r.monthly.total||r.monthly.completed+r.monthly.scheduled!==r.monthly.total||r.total>r.monthly.total)return false;
 const expected=r.summary.scheduled?r.summary.completed/r.summary.scheduled*100:0;if(Math.abs(expected-r.summary.percentage)>.0001)return false;
 if(!r.chart.every(s=>typeof s.state==='string'&&count(s.scheduled)&&count(s.completed))||new Set(r.chart.map(s=>s.state)).size!==r.chart.length)return false;
 if(r.chart.reduce((n,s)=>n+s.scheduled,0)!==r.summary.scheduled||r.chart.reduce((n,s)=>n+s.completed,0)!==r.summary.completed)return false;
 return r.rows.length<=r.total&&new Set(r.rows.map(row=>row.id)).size===r.rows.length&&r.rows.every(row=>row.id&&row.retail_store_id&&typeof row.store_code==='string'&&row.store_name&&row.state&&/^\d{4}-\d{2}-\d{2}$/.test(row.scheduled_date||'')&&typeof row.pdf_verified==='boolean')&&r.stores.every(s=>s.id&&s.state&&typeof s.store_code==='string');
}
export async function pdfIdentity(file,maxBytes=PDF_MAX_BYTES){
 if(!/\.pdf$/i.test(file.name)||file.type!==PDF_MIME||file.size<20||file.size>Math.min(maxBytes,PDF_MAX_BYTES))throw Error('Select a PDF up to 10 MB (10,000,000 bytes).');
 const bytes=await file.arrayBuffer();if(!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(new TextDecoder().decode(bytes.slice(0,10))))throw Error('The selected file has no valid PDF signature.');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function putPdf(url,file,onProgress){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.setRequestHeader('Content-Type',PDF_MIME);xhr.setRequestHeader('x-upsert','false');xhr.timeout=120000;
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*90));};
  xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error(`PDF upload failed (${xhr.status}). Retry the same original PDF.`));
  xhr.onerror=()=>reject(Error('PDF upload interrupted. Retry the same original PDF.'));xhr.ontimeout=xhr.onerror;xhr.send(file);
 });
}
export function pendingKey(user,id){return `thermography.v2.pdf:${user}:${id}`;}
export async function scheduleWorkbook({template=false,rows=[]}={}){
 const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(template?'Schedule':'Thermography');
 if(template){sheet.columns=[{header:'Store Code',key:'code',width:22},{header:'Scheduled Date',key:'date',width:24}];sheet.getColumn(1).numFmt='@';sheet.getColumn(2).numFmt='dd-mm-yyyy';}
 else {
  sheet.columns=['State','Store Code','Store Name','Scheduled Date','PDF Completed','Client Review','Report Filename'].map((header,i)=>({header,key:String(i),width:i===2?38:24}));
  for(const r of rows)sheet.addRow([r.state,r.store_code,r.store_name,r.scheduled_date,r.pdf_verified?'Completed':'Scheduled',r.report_review_state||r.status,r.filename||'']);
  sheet.getColumn(2).numFmt='@';
 }
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0750D8'}};sheet.views=[{state:'frozen',ySplit:1}];
 return new Blob([await book.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function exportRows(load,filters){
 const rows=[];let digest,total;
 for(let page=0;page<50;page++){
  const r=await load({...filters,page,limit:100});
  if(page===0){digest=r.scope_digest;total=r.total;}
  if(r.scope_digest!==digest||r.total!==total)throw Error('Schedule changed during export. Retry for consistent totals.');
  rows.push(...r.rows);if(new Set(rows.map(row=>row.id)).size!==rows.length||rows.length>total)throw Error('Export rows did not reconcile. Refresh before exporting.');if(rows.length===total)return rows;
 }
 throw Error('Export exceeds the supported monthly schedule limit.');
}
