// Review export only. No approval, preview-key or activation mutation.
const HEADERS = ['Site Code','Store Name / Location','City','Geographic State','Reporting State','Format','HK Staff','HK Supervisor','MEPC Shared','MEPC Supervisor','MEPC Stationed','Budget Start','Budget End','Source Sheet Row','Conflict / Closed Evidence','Audit Status','Approved (YES/NO)','Approval Ref','Reviewer Notes'];
const provenance = (r,p) => [r.source_row,r.store_code,r.state,r.canonical_id || '',p.checksum,r.row_digest,r.source_reference];
const evidenceHeaders = ['Original source row','Store Code','Geographic state','Canonical ID','Original file SHA-256','Original row SHA-256','Source reference'];

function table(workbook,name,headers,rows,{editable=[]}={}) {
  const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1,xSplit:2}]});
  sheet.addRow(headers);sheet.addRows(rows);
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:headers.length}};
  sheet.getRow(1).height=34;
  sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};});
  sheet.columns.forEach((column,i)=>{column.width=/SHA-256/.test(headers[i])?24:/evidence|conflict|reason|notes|name|reference/i.test(headers[i])?38:22;column.alignment={vertical:'top',wrapText:true};});
  for(let row=2;row<=sheet.rowCount;row++) {
    let lines=2;sheet.getRow(row).eachCell(cell=>{const width=sheet.getColumn(cell.col).width||22;lines=Math.max(lines,String(cell.value??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/(width-3))),0));});
    sheet.getRow(row).height=Math.min(409,Math.max(36,lines*15));
    for(const index of editable){const cell=sheet.getCell(row,index+1);cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};}
  }
  sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
  return sheet;
}

export async function buildRetailStoreReviewWorkbook(preview,{filename='',exportedAt=new Date()}={}) {
  if(!preview?.rows?.length || !preview.checksum)throw Error('Validate the source workbook before exporting its review.');
  const ExcelJS=(await import('exceljs')).default;const book=new ExcelJS.Workbook();book.creator='myQPMS';book.created=exportedAt;
  const rows=[...preview.rows].sort((a,b)=>a.source_row-b.source_row);
  table(book,'Review guide',['Field','Value'],[
    ['Purpose','Business review only. Spreadsheet edits do not grant approval or activate data.'],
    ['Original filename',filename],['Original file SHA-256',preview.checksum],['Preview batch ID',preview.id || 'Validation only'],['Exported at',exportedAt.toISOString()],
    ['Original source rows',rows.length],['Canonical stores',preview.canonical_count],
    ['Source sheet','STORE UPLOAD REVIEW preserves original literal cells and physical row numbers. Do not sort, insert or delete rows in that sheet. Use the filterable review sheets.'],
    ['Editable review fields','Yellow cells are business decision requests only, not approved registry entries. Blank means not supplied; no status, date or allocation is inferred.'],
    ['Identity approval','An authorized reviewer must supply actual identity/status/ownership evidence. Existing canonical identities are preserved.'],
    ['Approval binding','Upload the final reviewed source again. File edits change its SHA-256 and may change row digests. Registry approvals must bind the final file hash, source row and row digest.'],
    ['Explicit confirmation','A fresh authenticated Admin preview, registry evidence, current preview key and explicit independent scope confirmation are required. Old previews are rejected.'],
    ['AOP approval','Independent final HK/MEPC allocations and effective periods are required. Candidate components are not approved totals.'],
    ['Reporting','PY geography remains PY and reports under TN. KA/KN is canonical KA and reporting KN.'],
    ['Recovery','Attendance recovery requires separate affected-record review and approval. Export does not trigger recovery.'],
    ['Existing codes scope','Existing codes lists uploaded canonical matches only. State totals include all canonical stores; omitted canonical rows are not available in this preview.'],
  ]);
  table(book,'State summary',['Geography','Reporting','Existing canonical stores','Source rows','Unique upload codes','Existing match codes','Proposed absent codes','Approved identity rows','Approved AOP rows'],(preview.states||[]).map(s=>[s.state,s.reporting_state,s.existing,s.uploaded_rows,s.unique_upload_codes,s.existing_matches,s.proposed_new_codes.length,s.approved_identity_rows,s.approved_aop_rows]));
  const source=book.addWorksheet('STORE UPLOAD REVIEW',{views:[{state:'frozen',ySplit:1}]});source.addRow(HEADERS);
  for(const r of rows){if(!Number.isInteger(r.source_row)||r.source_row<2||r.source_row>10001)throw Error('Invalid retained source row.');source.getRow(r.source_row).values=HEADERS.map(h=>r.raw?.[h]??'');}
  source.columns.forEach(c=>{c.width=24;c.alignment={wrapText:true,vertical:'top'};});source.getRow(1).font={bold:true};source.autoFilter=`A1:S${source.rowCount}`;
  source.eachRow(row=>{row.height=48;});
  const details=r=>[...provenance(r,preview),r.store_name,r.reporting_state,r.canonical_state||'',r.raw?.['Audit Status']||'',r.conflict_evidence||'',r.identity_action,r.approval,r.approval_ref,r.issues.join('; ')];
  const detailHeaders=[...evidenceHeaders,'Source name','Reporting state','Canonical geography','Source audit status (not verified operating status)','Source conflict evidence','Identity disposition','Source YES/NO','Source approval reference','Validation issues'];
  const stateSort=(a,b)=>a.state.localeCompare(b.state)||a.store_code.localeCompare(b.store_code)||a.source_row-b.source_row;
  table(book,'Proposed stores',detailHeaders,rows.filter(r=>!r.canonical_id).sort(stateSort).map(details));
  table(book,'Existing codes',detailHeaders,rows.filter(r=>r.canonical_id).sort(stateSort).map(details));
  table(book,'Conflicts',detailHeaders,rows.filter(r=>r.issues.length).sort(stateSort).map(details));
  const identityHeaders=[...evidenceHeaders,'Identity disposition','Registry decision ID','Official single code','Official name','Verified geography','Verified operating status','Genuine ownership model','Verified supervisor or FO-zone evidence','Reviewer profile ID','Approval reference','Evidence SHA-256','Approval timestamp','Approval validity end','Business decision','Reviewer notes'];
  const identity=table(book,'Identity decisions',identityHeaders,rows.map(r=>[...provenance(r,preview),r.identity_action,r.identity_decision_id||'',...Array(13).fill('')]),{editable:Array.from({length:13},(_,i)=>i+9)});
  for(let i=2;i<=identity.rowCount;i++)identity.getCell(i,21).dataValidation={type:'list',allowBlank:true,formulae:['"PENDING,REQUEST_APPROVAL,REJECT"']};
  table(book,'Independent AOP',[...evidenceHeaders,'AOP disposition','Registry AOP decision ID','Candidate HK Staff','Candidate HK Supervisor','Candidate MEPC Shared','Candidate MEPC Supervisor','Candidate MEPC Stationed','Candidate period start','Candidate period end','Final reviewed HK allocation','Final reviewed MEPC allocation','Approved effective start','Approved effective end','AOP reviewer profile ID','AOP approval reference','AOP evidence SHA-256','AOP decision','AOP notes'],rows.map(r=>[...provenance(r,preview),r.aop_action,r.aop_decision_id||'',...['HK Staff','HK Supervisor','MEPC Shared','MEPC Supervisor','MEPC Stationed'].map(k=>r.components?.[k]??''),r.effective_from,r.effective_to,...Array(9).fill('')]),{editable:Array.from({length:9},(_,i)=>i+16)});
  return book;
}

export async function exportRetailStoreReview(preview,options) {
  const book=await buildRetailStoreReviewWorkbook(preview,options);const bytes=await book.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='retail-store-master-aop-review.xlsx';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
