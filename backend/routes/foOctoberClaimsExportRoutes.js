import express from 'express';
import PDFDocument from 'pdfkit';
import {adminKmApprovalAuthorization} from '../services/foKmRecalculationAuthorizationService.js';
import {employeeKey,octoberClaimData,octoberError} from '../services/foOctoberClaimsService.js';
const STATES=new Set(['AP','KA','KL','TN','TG']);
const BUSINESSES=new Set(['Reliance Retail','Standalone','DME']);
const text=value=>String(value??'').replace(/[\r\n\t]/g,' ');
const amount=cents=>(cents/100).toFixed(2);
export function renderOctoberClaimsPdf(data){
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:35,bufferPages:true});
 const header=(group,details=false)=>{
  doc.font('Helvetica-Bold').fontSize(16).text('QPMS | CONSOLIDATED TRAVEL CLAIMS',35,28);
  doc.font('Helvetica').fontSize(10).text(`October 01-31, 2026 | ${text(group)}`,35,52,{width:770});
  doc.fontSize(9).text('Provisional report. Proposed and Admin-approved additional KM are NOT financially posted.',35,69,{width:770});
  doc.moveTo(35,88).lineTo(807,88).strokeColor('#999').stroke();
  if(details){doc.font('Helvetica-Bold').fontSize(10).text('Admin decisions - reconciliation only',35,98);return;}
  doc.font('Helvetica-Bold').fontSize(8);
  for(const[x,label,width]of [[35,'Employee Code',100],[140,'Employee Name',165],[310,'Payable KM',75],[390,'Proposed KM',75],[470,'Difference KM',65],[540,'Petrol INR',80],[625,'Approved KM (unposted)',95],[725,'Adjustment status',80]])doc.text(label,x,98,{width});
 };
 let first=true;
 const page=(group,details=false)=>{if(!first)doc.addPage();first=false;header(group,details)};
 if(!data.groups.length){page('No matching records');doc.font('Helvetica').fontSize(10).text('No October attendance records match the selected filters.',35,135)}
 for(const group of data.groups){
  for(let start=0;start<group.rows.length;start+=17){
   page(group.name);let y=126;doc.font('Helvetica').fontSize(8);
   for(const r of group.rows.slice(start,start+17)){
    for(const[x,value,width]of [[35,r.employee_code,100],[140,r.name,165],[310,amount(r.original),75],[390,amount(r.proposed),75],[470,amount(r.proposed-r.original),65],[540,amount(r.petrol),80],[625,amount(r.approvedKm),95],[725,r.status,80]])doc.text(text(value),x,y,{width,ellipsis:true,lineBreak:false});
    y+=21;doc.moveTo(35,y-6).lineTo(807,y-6).strokeColor('#e5e7eb').stroke();
   }
   if(start+17>=group.rows.length){
    const sum=key=>group.rows.reduce((n,r)=>n+r[key],0);
    doc.font('Helvetica-Bold').fontSize(10).text(`Group totals: Payable ${amount(sum('original'))} KM | Proposed ${amount(sum('proposed'))} KM | Petrol INR ${amount(sum('petrol'))}`,35,y+8,{width:770});
    doc.font('Helvetica').fontSize(9).text(`Original review cases: ${sum('reviews')} | Pending: ${sum('pending')} | Clarification: ${sum('clarification')} | Admin approved: ${sum('approved')} (${amount(sum('approvedKm'))} KM, not posted)`,35,y+27,{width:770});
   }
  }
  const decisions=group.rows.flatMap(r=>r.decisions);
  if(decisions.length){
   page(group.name,true);let y=125;
   for(const d of decisions){
    const lines=[`${text(d.employee_code)} | ${d.attendance_date} | ${text(d.decision)} | Additional KM (NOT POSTED): ${Number(d.approved_additional_km).toFixed(2)}`,`Admin Auth ID: ${d.approved_by} | Decided: ${d.decided_at}`,`Evidence: ${text(d.evidence_reference)}`,`Justification: ${text(d.justification)}`];
    for(const line of lines){doc.font('Helvetica').fontSize(9);const height=doc.heightOfString(line,{width:770});if(y+height>530){page(group.name,true);y=125;doc.font('Helvetica').fontSize(9)}doc.text(line,35,y,{width:770});y+=height+4}y+=10;
   }
  }
 }
 // Every page receives global pagination; footers never trigger another page.
 const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#555').text(`Page ${i+1} of ${range.count} | Existing payable and petrol only are financially posted.`,35,548,{width:770,lineBreak:false})}
 return doc;
}
export function createOctoberClaimsExportRouter({requireAuth,getClient}){
 const router=express.Router();
 router.get('/october-2026.pdf',requireAuth,async(req,res)=>{
  try{
   adminKmApprovalAuthorization(req.profile,req.authUser,'October 2026 claims PDF export');
   if(Object.keys(req.query).some(key=>!['state','business','employee'].includes(key)))throw octoberError('Invalid report filter.',400);
   for(const key of ['state','business','employee'])if(req.query[key]!=null&&typeof req.query[key]!=='string')throw octoberError('Invalid report filter.',400);
   const state=String(req.query.state||'').trim().toUpperCase(),business=String(req.query.business||'').trim(),employee=employeeKey(req.query.employee||'');
   if(state&&!STATES.has(state)||business&&!BUSINESSES.has(business)||employee.length>80)throw octoberError('Invalid report filter.',400);
   const data=await octoberClaimData(getClient(),{state,business,employee});
   const doc=renderOctoberClaimsPdf(data);
   doc.on('error',error=>res.destroy(error));
   res.type('application/pdf');res.setHeader('Content-Disposition','attachment; filename="QPMS_Oct2026_Consolidated_Claims.pdf"');
   res.setHeader('X-October-Attendance-Rows',String(data.totals.attendance_rows));
   res.setHeader('X-October-Payable-Km',amount(data.totals.original));res.setHeader('X-October-Petrol',amount(data.totals.petrol));
   res.setHeader('Cache-Control','private, no-store');doc.pipe(res);doc.end();
  }catch(error){if(res.headersSent)return res.destroy(error);res.status(error.statusCode||(error.code==='42501'?403:503)).json({ok:false,message:error.statusCode?error.message:error.code==='42501'?'Report database permission unavailable.':'October PDF export unavailable; no financial data was changed.'})}
 });
 return router;
}
