import {notRecorded} from './trainingExport.js';
import {containTrainingPhoto} from './trainingExportFiles.js';

const text=value=>String(notRecorded(value));
const date=value=>value&&!Number.isNaN(Date.parse(value))?new Date(value):'Not recorded';
export function cleaningExportTotals(records,key) {
  const groups=new Map();
  for(const r of records){const id=key==='state'?text(r.state):[r.state,r.storeCode,r.storeName].join('|');const g=groups.get(id)||{state:text(r.state),storeCode:text(r.storeCode),storeName:text(r.storeName),count:0};g.count++;groups.set(id,g);}
  return [...groups.values()].sort((a,b)=>a.state.localeCompare(b.state)||a.storeCode.localeCompare(b.storeCode));
}
export async function buildCleaningWorkbook(data,{title,scope}) {
  const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();book.creator='myQPMS';book.title=title;
  const sheet=(name,headers,rows)=>{
    const s=book.addWorksheet(name);s.addRow(headers);s.addRows(rows);s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rowCount),column:headers.length}};
    s.columns.forEach((c,i)=>{c.width=headers[i].includes('ID')?38:headers[i].includes('Reference')||headers[i].includes('Warning')?55:27;});
    s.eachRow((r,index)=>{r.alignment={vertical:'top',wrapText:true};r.height=42;if(index===1){r.font={bold:true,color:{argb:'FFFFFFFF'}};r.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF185AA6'}};}else r.eachCell(c=>{if(c.value instanceof Date)c.numFmt=headers[c.col-1].includes('Timestamp')?'yyyy-mm-dd hh:mm:ss "UTC"':'yyyy-mm-dd';});});
    s.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};return s;
  };
  sheet('Summary',['Metric / State','Submitted records / Value'],[[title,scope],['Persisted submitted records',data.records.length],...cleaningExportTotals(data.records,'state').map(g=>[g.state,g.count]),['Reporting note','Actual cleaning dates; submitted records are independent of scheduled KPIs.'],['Evidence note','Authenticated references require fresh access through myQPMS. No temporary signed Storage URLs are retained.']]);
  sheet('Store summary',['State','Store Code','Store Name','Submitted Records'],cleaningExportTotals(data.records,'store').map(g=>[g.state,g.storeCode,g.storeName,g.count]));
  sheet('Submissions',['Submission ID','State','Store Code','Store Name','Actual Cleaning Date','FO Name','Employee Code','Status','Submission Timestamp','Evidence Count','Evidence Availability'],data.records.map(r=>[r.id,text(r.state),text(r.storeCode),text(r.storeName),date(r.date),text(r.fo),text(r.employeeCode),text(r.status),date(r.submittedAt),r.evidenceStatus==='Authorized evidence list received'||r.evidenceStatus==='No uploaded evidence recorded'?r.evidence.length:'Not recorded',r.evidenceStatus]));
  sheet('Evidence manifest',['Submission ID','Evidence ID','Type','File Name','MIME Type','Access Status','Authenticated Reference'],data.records.flatMap(r=>r.evidence.length?r.evidence.map(e=>[r.id,text(e.id),text(e.type),text(e.fileName),text(e.mime),e.access,e.reference]):[[r.id,'Not recorded','Not recorded','Not recorded','Not recorded',r.evidenceStatus,'Not recorded']]));
  sheet('Warnings',['Warning'],data.warnings.length?data.warnings.map(w=>[w]):[['No export warnings. Photographs are embedded in PowerPoint, not Excel.']]);
  return book;
}
export async function buildCleaningPresentation(data,{title,scope}) {
  const {default:PptxGenJS}=await import('pptxgenjs'),pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='myQPMS';pptx.company='QPMS';pptx.title=title;pptx.subject='Reliance Retail Deep Cleaning';pptx.lang='en-IN';pptx.theme={headFontFace:'Aptos',bodyFontFace:'Aptos',lang:'en-IN'};
  const chunks=(items,n)=>Array.from({length:Math.ceil(items.length/n)},(_,i)=>items.slice(i*n,(i+1)*n));
  const slide=heading=>{const s=pptx.addSlide();s.background={color:'FFFFFF'};s.addText(heading,{x:.55,y:.35,w:12.2,h:.9,fontSize:29,bold:true,color:'185AA6',margin:0,fit:'resize'});s.addText('myQPMS | Reliance Retail Deep Cleaning',{x:.55,y:7.08,w:12,h:.22,fontSize:10,color:'64748B',margin:0});return s;};
  const pages=(heading,items)=>{const lines=items.flatMap(item=>text(item).match(/.{1,88}(?:\s|$)|.{1,88}/g)||['']);for(const batch of chunks(lines,10)){const s=slide(heading);s.addText(batch.join('\n'),{x:.6,y:1.55,w:12,h:5.15,fontSize:18,color:'183153',margin:0,paraSpaceAfterPt:10,valign:'top'});}};
  pages(title,[scope,`${data.records.length} persisted submitted records`,'Actual cleaning dates; independent of scheduled KPIs.',...(!data.records.length?['No submitted records match this selection.']:[])]);
  for(const group of chunks(cleaningExportTotals(data.records,'state'),10))slide('State-wise overview').addTable([['State','Submitted records'],...group.map(g=>[g.state,g.count])],{x:.6,y:1.55,w:12,h:4.9,fontSize:18,border:{pt:.5,color:'DCE5F1'},autoPage:false});
  for(const group of chunks(cleaningExportTotals(data.records,'store'),8))slide('Store-wise overview').addTable([['State','Store Code','Store Name','Records'],...group.map(g=>[g.state,g.storeCode,g.storeName,g.count])],{x:.6,y:1.55,w:12,h:4.9,fontSize:16,border:{pt:.5,color:'DCE5F1'},autoPage:false});
  const ordered=[...data.records].sort((a,b)=>text(a.state).localeCompare(text(b.state))||text(a.storeCode).localeCompare(text(b.storeCode))||text(a.date).localeCompare(text(b.date)));
  for(const r of ordered) {
    pages(`Deep Cleaning | ${text(r.storeCode)}`,[`Store: ${text(r.storeName)}`,`State: ${text(r.state)} | Actual cleaning date: ${text(r.date)}`,`FO: ${text(r.fo)} | Employee code: ${text(r.employeeCode)}`,`Status: ${text(r.status)} | Submitted: ${text(r.submittedAt)}`,`Submission: ${r.id}`,`Evidence: ${r.evidenceStatus}`]);
    // Align independently ordered before/after photographs for visual review.
    // Matching positions do not assert that two photographs depict the same area.
    const before=r.evidence.filter(e=>e.type==='before'&&e.image);
    const after=r.evidence.filter(e=>e.type==='after'&&e.image);
    const count=Math.max(before.length,after.length);
    if(!count)pages(`Photo evidence | ${text(r.storeCode)}`,[
      'No authorized Before or After photographs available in this export.',
      r.evidenceStatus,'See export warnings for missing evidence or access failures.'
    ]);
    for(let i=0;i<count;i+=2){
      const sheet=slide(`Deep Cleaning Evidence | ${text(r.storeCode)}`);
      sheet.addText(`Store Code: ${text(r.storeCode)}  |  Visit Date: ${text(r.date)}  |  Uploaded Date: ${text(r.submittedAt)}`,{
        x:.6,y:1.15,w:12.1,h:.35,fontSize:13,color:'183153',margin:0,fit:'shrink'
      });
      sheet.addText('BEFORE',{x:.6,y:1.6,w:5.85,h:.35,fontSize:17,bold:true,color:'185AA6',align:'center'});
      sheet.addText('AFTER',{x:6.85,y:1.6,w:5.85,h:.35,fontSize:17,bold:true,color:'185AA6',align:'center'});
      const pair=[[before[i],.6,'Before'],[after[i],6.85,'After']];
      for(const [e,x,label] of pair){
        if(!e){sheet.addText('No corresponding image',{x,y:2.15,w:5.85,h:3.6,fontSize:13,color:'64748B',align:'center',valign:'mid'});continue;}
        sheet.addImage({data:e.image,...containTrainingPhoto(e.width,e.height,x,2.1,5.85,3.85)});
        sheet.addText(`${label} Image ${i+1}`,{x,y:6.05,w:5.85,h:.3,fontSize:13,bold:true,color:'183153',align:'center',margin:0});
        sheet.addNotes(`Submission ${r.id}; ${label}; evidence ${e.id}; ${e.reference}. Display-order alignment only; not a verified image pair.`);
      }
      sheet.addText('Images aligned by sequence only; locations are not independently matched.',{
        x:.6,y:6.55,w:12,h:.25,fontSize:9,color:'64748B',margin:0
      });
    }
    const supporting=r.evidence.filter(e=>!['before','after'].includes(e.type));
    pages(`Supporting evidence | ${text(r.storeCode)}`,supporting.length?supporting.map(e=>`${text(e.type)} | ${text(e.fileName)} | ${e.access}`):['Supporting evidence: Not recorded or unavailable.']);
    for(const batch of chunks(supporting.filter(e=>e.image),2)){const s=slide(`Supporting photograph | ${text(r.storeCode)}`);for(const [i,e] of batch.entries()){const x=.6+i*6.15,w=batch.length===1?12:5.85;s.addImage({data:e.image,...containTrainingPhoto(e.width,e.height,x,1.6,w,4.5)});s.addText(text(e.fileName),{x,y:6.25,w,h:.45,fontSize:12,margin:0,fit:'resize'});}}
  }
  pages('Evidence access and export warnings',['Supporting documents remain available through the authenticated dashboard. PDFs are listed, not embedded. No temporary signed URLs are retained.',...(data.warnings.length?data.warnings:['No export warnings.'])]);
  return pptx;
}
export async function downloadCleaningExport(data,{format,filename,...options}) {
  let bytes,type;
  if(format==='xlsx'){const book=await buildCleaningWorkbook(data,options);bytes=await book.xlsx.writeBuffer();type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
  else {const deck=await buildCleaningPresentation(data,options);bytes=await deck.write({outputType:'arraybuffer'});type='application/vnd.openxmlformats-officedocument.presentationml.presentation';}
  const url=URL.createObjectURL(new Blob([bytes],{type}));
  try{const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
