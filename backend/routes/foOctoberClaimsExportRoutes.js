import express from 'express';
import PDFDocument from 'pdfkit';
import {adminKmApprovalAuthorization} from '../services/foKmRecalculationAuthorizationService.js';
import {employeeKey,octoberError} from '../services/foOctoberClaimsService.js';
import {octoberPaymentClaimData} from '../services/foOctoberPaymentClaimsService.js';
const STATES=new Set(['AP','KA','KL','TN','TG']);
const BUSINESSES=new Set(['Reliance Retail','Standalone','DME']);
const text=value=>String(value??'').replace(/[\r\n\t]/g,' ');
const amount=cents=>(cents/100).toFixed(2);
export function renderOctoberClaimsPdf(data){
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:35,bufferPages:true});
 const columns=[[35,'Employee Code',100],[140,'Employee Name',175],[320,'Payable KM',80],[405,'Petrol Amount (INR)',90],[500,'Other Travel Claims (INR)',100],[605,'Parking/Ticket Claims (INR)',100],[710,'Total Amount (INR)',95]];
 let first=true;
 const page=group=>{if(!first)doc.addPage();first=false;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text('QPMS | CONSOLIDATED TRAVEL CLAIMS',35,28);
  doc.font('Helvetica').fontSize(10).text('October 01-31, 2026 | '+text(group),35,52,{width:770});
  doc.fontSize(8).text('Payment evidence: stored petrol + verified expenses only. INR = Indian rupees. N/A = no verified expense evidence.',35,69,{width:770});
  doc.font('Helvetica-Bold').fontSize(8);for(const[x,label,width]of columns)doc.text(label,x,96,{width});
 };
 if(!data.groups.length){page('No matching records');doc.font('Helvetica').fontSize(10).text('No employees with nonzero report payable KM match the filters.',35,140)}
 for(const group of data.groups){
  for(let start=0;start<group.rows.length;start+=14){page(group.name);let y=135;doc.font('Helvetica').fontSize(8);
   for(const r of group.rows.slice(start,start+14)){
    const values=[r.employee_code,r.name,amount(r.reportKm)+(r.reportOnlyKm?'*':''),amount(r.petrol),r.otherVerified?amount(r.other):'N/A',r.parkingTicketVerified?amount(r.parkingTicket):'N/A',amount(r.total)+(!r.otherVerified||!r.parkingTicketVerified||r.pendingExpenses?'*':'')];
    columns.forEach(([x,,width],i)=>doc.text(text(values[i]),x,y,{width,ellipsis:true,lineBreak:false}));y+=21;
    doc.moveTo(35,y-6).lineTo(807,y-6).strokeColor('#e5e7eb').stroke();
   }
   if(start+14>=group.rows.length){
    const sum=k=>group.rows.reduce((n,r)=>n+r[k],0),values=['GROUP TOTAL','',amount(sum('reportKm')),amount(sum('petrol')),amount(sum('other')),amount(sum('parkingTicket')),amount(sum('total'))+'*'];
    doc.font('Helvetica-Bold').fontSize(8);columns.forEach(([x,,width],i)=>doc.text(values[i],x,y+5,{width,lineBreak:false}));
   }
   doc.font('Helvetica').fontSize(8).text('* Amount totals are verified subtotals, not final settlement approval. N/A and unapproved expenses are excluded.',35,467,{width:770});
   doc.text('Other travel: approved auto/other fares. Parking/ticket: approved parking, bus/train tickets and explicit ticket/fare claims; each counted once.',35,481,{width:770});
   const pending=group.rows.reduce((n,r)=>n+r.pendingExpenses,0);doc.text('Expense records pending verification (excluded): '+pending+'. Group expense totals sum verified records only; 0.00 does not approve absent evidence.',35,500,{width:770});
   const extras=group.rows.filter(r=>r.reportOnlyKm);if(extras.length)doc.text(extras.map(r=>r.employee_code+': '+amount(r.original)+' posted + '+amount(r.reportOnlyKm)+' report-only KM; Branch Head-approved, Super Admin-confirmed, pending formal audit verification. No additional petrol posted.').join(' '),35,520,{width:770});
  }
 }
 const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#555').text('Page '+(i+1)+' of '+range.count+' | Existing financial records unchanged.',35,548,{width:770,lineBreak:false})}
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
   const data=await octoberPaymentClaimData(getClient(),{state,business,employee});
   const doc=renderOctoberClaimsPdf(data);
   doc.on('error',error=>res.destroy(error));
   res.type('application/pdf');res.setHeader('Content-Disposition','attachment; filename="QPMS_Oct2026_Consolidated_Claims.pdf"');
   res.setHeader('X-October-Attendance-Rows',String(data.totals.attendance_rows));
   res.setHeader('X-October-Payable-Km',amount(data.totals.reportKm));res.setHeader('X-October-Petrol',amount(data.totals.petrol));
   res.setHeader('Cache-Control','private, no-store');doc.pipe(res);doc.end();
  }catch(error){if(res.headersSent)return res.destroy(error);res.status(error.statusCode||(error.code==='42501'?403:503)).json({ok:false,message:error.statusCode?error.message:error.code==='42501'?'Report database permission unavailable.':'October PDF export unavailable; no financial data was changed.'})}
 });
 return router;
}
