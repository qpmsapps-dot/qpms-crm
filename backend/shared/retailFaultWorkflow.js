export const RETAIL_FAULT_STAGES=['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending'];
export function verifiedWeeklyCompletions(tickets,now=new Date()){
 if(!tickets.length||tickets.some(t=>!Array.isArray(t.verifiedUpdates)))return null;
 const india=new Date(now.getTime()+330*60000),start=new Date(Date.UTC(india.getUTCFullYear(),india.getUTCMonth(),india.getUTCDate()));
 start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 const from=start.getTime()-330*60000;
 return tickets.filter(t=>t.verifiedUpdates.some(e=>e.update_type==='WORK_COMPLETED'&&e.metadata?.retail_workflow_version===1&&Number.isFinite(Date.parse(e.created_at))&&Date.parse(e.created_at)>=from&&Date.parse(e.created_at)<=now.getTime())).length;
}
