import {notRecorded} from './trainingExport.js';

const text=value=>String(notRecorded(value));
const date=value=>value&&/^\d{4}-\d{2}-\d{2}/.test(value)&&!Number.isNaN(Date.parse(value))?new Date(value):notRecorded(null);
function stateTotals(sessions) {
  const states=new Map();
  for(const s of sessions){const state=text(s.state),row=states.get(state)||{state,hk:0,mepc:0};row[s.trainingClass==='HK'?'hk':'mepc']++;states.set(state,row);}
  return [...states.values()].sort((a,b)=>a.state.localeCompare(b.state));
}
export async function buildTrainingWorkbook(data,{title,scope}) {
  const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();
  book.creator='myQPMS';book.title=title;
  const sheet=(name,headers,rows)=>{
    const s=book.addWorksheet(name);s.addRow(headers);s.addRows(rows);
    s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rowCount),column:headers.length}};
    s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF185AA6'}};
    s.getRow(1).height=42;s.getRow(1).alignment={vertical:'middle',wrapText:true};
    s.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};
    s.columns.forEach((c,i)=>{c.width=headers[i].includes('ID')?38:headers[i].includes('Topic')||headers[i].includes('Reference')||headers[i].includes('Warning')?48:25;});
    s.eachRow((r,index)=>{if(index>1){r.alignment={vertical:'top',wrapText:true};let lineCount=1;r.eachCell(c=>{if(c.value instanceof Date)c.numFmt=headers[c.col-1]?.includes('Timestamp')?'yyyy-mm-dd hh:mm:ss "UTC"':'yyyy-mm-dd';else lineCount=Math.max(lineCount,Math.ceil(String(c.value??'').length/Math.max(10,s.getColumn(c.col).width-3)));});r.height=Math.min(409,Math.max(30,lineCount*16+8));}});
    return s;
  };
  sheet('Summary',['Metric / State','HK sessions','MEPC sessions','Total / Value'],[
    [title,'','',scope],['Verified sessions',data.sessions.filter(s=>s.trainingClass==='HK').length,data.sessions.filter(s=>s.trainingClass==='MEPC').length,data.sessions.length],
    ...stateTotals(data.sessions).map(s=>[s.state,s.hk,s.mepc,s.hk+s.mepc]),
    ['Historical Excel rows (separate)','','',data.historical.length],['Attendee note','','','An empty optional register is Not recorded, not zero attendees.'],
    ['Evidence note','','','References require a new authorized request through myQPMS. No signed Storage links are included.']
  ]);
  sheet('Sessions',['Session ID','Training Date','Class','State','Zone','Historical Zone ID','Historical FO ID','Store Code','Store Name','Trainer','Trainer Employee Code','Attendee Count','Status','Submission Timestamp','Evidence Count'],data.sessions.map(s=>[
    s.id,date(s.date),s.trainingClass,text(s.state),text(s.zone),text(s.zoneId),text(s.foId),text(s.storeCode),text(s.storeName),text(s.trainer),text(s.trainerCode),notRecorded(s.attendeeCount),s.status,date(s.submittedAt),s.evidence.length
  ]));
  sheet('Topics',['Session ID','Session Topic ID','Topic / Module','Topic Description','Covered','Completed Timestamp','Remarks'],data.sessions.flatMap(s=>s.topics.length?s.topics.map(t=>[s.id,t.id,text(t.topic?.module_name||t.topic?.name),text(t.topic?.topic_description),t.is_covered===true?'Yes':t.is_covered===false?'No':'Not recorded',date(t.completed_at),text(t.remarks)]):[[s.id,'Not recorded','Not recorded','Not recorded','Not recorded','Not recorded','Not recorded']]));
  sheet('Attendees',['Session ID','Attendee ID','Employee Code','Employee Name','Designation'],data.sessions.flatMap(s=>s.attendees.length?s.attendees.map(a=>[s.id,a.id,text(a.employee_code),text(a.employee_name),text(a.designation_snapshot)]):[[s.id,'Not recorded','Not recorded','Not recorded','Not recorded']]));
  sheet('Evidence manifest',['Session ID','Evidence ID','Session Topic ID','Type','File Name','MIME Type','Bytes','Access Status','Authenticated Reference'],data.sessions.flatMap(s=>s.evidence.length?s.evidence.map(e=>[s.id,e.id,text(e.topicId),text(e.type),text(e.fileName),text(e.mime),notRecorded(e.size==null?null:Number(e.size)),e.access,e.reference]):[[s.id,'Not recorded','Not recorded','Not recorded','Not recorded','Not recorded','Not recorded','No uploaded evidence recorded','Not recorded']]));
  sheet('Warnings',['Warning'],data.warnings.length?data.warnings.map(w=>[w]):[['No export warnings. Photo contents are not embedded in Excel.']]);
  if(data.historical.length) sheet('Historical Excel source',['Source Row ID','Date','Class','State','Store Code','Store Name','Source Employee','Employee Code','Reported Topics','Status','Evidence'],data.historical.map(r=>[r.id,date(r.training_date),r.training_class,text(r.state),text(r.store?.store_code),text(r.store?.store_name),text(r.source_data?.employee_name),text(r.employee_code),text(r.topics_text),text(r.status),'Not provided; unverified source row']));
  return book;
}
const BLUE='185AA6',INK='183153';
export function containTrainingPhoto(width,height,x,y,w,h) {
  if(!(width>0&&height>0))throw Error('Photo dimensions unavailable');
  const scale=Math.min(w/width,h/height),imageW=width*scale,imageH=height*scale;
  return {x:x+(w-imageW)/2,y:y+(h-imageH)/2,w:imageW,h:imageH};
}
export async function buildTrainingPresentation(data,{title,scope}) {
  const {default:PptxGenJS}=await import('pptxgenjs'),pptx=new PptxGenJS();
  pptx.layout='LAYOUT_WIDE';pptx.author='myQPMS';pptx.subject='Reliance Retail HK & MEPC Training';pptx.title=title;pptx.company='QPMS';pptx.lang='en-IN';
  pptx.theme={headFontFace:'Aptos',bodyFontFace:'Aptos',lang:'en-IN'};
  const slide=(heading)=>{const s=pptx.addSlide();s.background={color:'FFFFFF'};s.addText(heading,{x:.55,y:.35,w:12.2,h:.9,fontSize:30,bold:true,color:BLUE,breakLine:false,margin:0,fit:'resize'});s.addText('myQPMS | Reliance Retail Training',{x:.55,y:7.08,w:11.8,h:.22,fontSize:10,color:'64748B',margin:0});return s;};
  const lines=(s,items,y=1.55)=>s.addText(items.join('\n'),{x:.6,y,w:12,h:5.15-(y-1.55),fontSize:18,color:INK,breakLine:false,margin:0,paraSpaceAfterPt:10,valign:'top'});
  const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
  const pages=(heading,items)=>{
    const wrapped=items.flatMap(item=>text(item).match(/.{1,88}(?:\s|$)|.{1,88}/g)||['']);
    for(const batch of chunks(wrapped,10))lines(slide(heading),batch.map(line=>line.trim()));
  };
  pages(title,[scope,`${data.sessions.length} verified sessions`,`${data.sessions.filter(s=>s.trainingClass==='HK').length} HK | ${data.sessions.filter(s=>s.trainingClass==='MEPC').length} MEPC`,...(data.sessions.length?[]:['No submitted sessions match this selection.'])]);
  for(const batch of chunks(stateTotals(data.sessions),10)) {
    const s=slide('State-wise Training overview');
    s.addTable([['State','HK','MEPC','Total'],...batch.map(r=>[r.state,r.hk,r.mepc,r.hk+r.mepc])],{x:.6,y:1.55,w:12,h:4.9,fontSize:18,color:INK,border:{pt:.5,color:'DCE5F1'},rowH:.4,autoPage:false});
  }
  const ordered=[...data.sessions].sort((a,b)=>text(a.state).localeCompare(text(b.state))||text(a.storeCode).localeCompare(text(b.storeCode))||text(a.date).localeCompare(text(b.date)));
  let previousStore;
  for(const session of ordered) {
    const storeKey=[session.state,session.storeCode,session.storeName].join('|');
    if(storeKey!==previousStore){pages(`Store | ${text(session.storeCode)}`,[text(session.storeName),text(session.state),'Store-wise Training report']);previousStore=storeKey;}
    pages(`${session.trainingClass} Training | ${text(session.storeCode)}`,[`Store: ${text(session.storeName)}`,`Date: ${text(session.date)} | State: ${text(session.state)}`,`Trainer: ${text(session.trainer)} | Employee code: ${text(session.trainerCode)}`,`Attendees: ${text(session.attendeeCount)} | Status: ${session.status}`,`Submitted: ${text(session.submittedAt)}`,`Session: ${session.id}`]);
    const topicLines=session.topics.map(t=>`${text(t.topic?.module_name||t.topic?.name)}: ${text(t.topic?.topic_description)} — ${t.is_covered===true?'Covered':t.is_covered===false?'Not covered':'Coverage not recorded'}`);
    pages(`Topics | ${session.trainingClass} | ${text(session.storeCode)}`,topicLines.length?topicLines:['Topics: Not recorded']);
    pages(`Recorded attendees | ${text(session.storeCode)}`,session.attendees.length?session.attendees.map(a=>`${text(a.employee_name)} | ${text(a.employee_code)} | ${text(a.designation_snapshot)}`):['Attendee details: Not recorded']);
    const photos=session.evidence.filter(e=>e.image);
    if(!photos.length){const t=slide(`Photographs | ${text(session.storeCode)}`);lines(t,['No authorized photographs available in this export.','See export warnings for authorization or download failures.']);}
    for(const batch of chunks(photos,2)) {
      const t=slide(`Training photographs | ${session.trainingClass} | ${text(session.storeCode)}`);
      for(const [i,e] of batch.entries()) {
        const x=.6+i*6.15,w=batch.length===1?12:5.85;
        try {t.addImage({data:e.image,...containTrainingPhoto(e.imageWidth,e.imageHeight,x,1.6,w,4.5)});}
        catch {data.warnings.push(`${session.id} / ${e.id}: Photograph could not be decoded for PowerPoint.`);t.addText('Photograph could not be decoded',{x,y:2.8,w:5.8,h:1,fontSize:18,color:INK});}
        t.addText(text(e.fileName),{x,y:6.25,w,h:.45,fontSize:12,color:INK,margin:0,fit:'resize'});
        t.addNotes(`Session ${session.id}; evidence ${e.id}; ${e.reference}. Authorized at export; no temporary Storage URL retained.`);
      }
    }
  }
  pages('Export warnings',data.warnings);
  return pptx;
}
export async function downloadTrainingExport(data,{format,filename,...options}) {
  let bytes,type;
  if(format==='xlsx'){const book=await buildTrainingWorkbook(data,options);bytes=await book.xlsx.writeBuffer();type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
  else {const deck=await buildTrainingPresentation(data,options);bytes=await deck.write({outputType:'arraybuffer'});type='application/vnd.openxmlformats-officedocument.presentationml.presentation';}
  const url=URL.createObjectURL(new Blob([bytes],{type}));
  try {const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();}
  finally {setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
