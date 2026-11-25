export const RETAIL_FAULT_STAGES=['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT','Pest Control','HK','Work Completed - Call Yet to Close'];
export function verifiedWeeklyCompletions(tickets,now=new Date()){
 if(!tickets.length||tickets.some(t=>!Array.isArray(t.verifiedUpdates)))return null;
 const india=new Date(now.getTime()+330*60000),start=new Date(Date.UTC(india.getUTCFullYear(),india.getUTCMonth(),india.getUTCDate()));
 start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 const from=start.getTime()-330*60000;
 return tickets.filter(t=>t.verifiedUpdates.some(e=>e.update_type==='WORK_COMPLETED'&&e.metadata?.retail_workflow_version===1&&Number.isFinite(Date.parse(e.created_at))&&Date.parse(e.created_at)>=from&&Date.parse(e.created_at)<=now.getTime())).length;
}

export const RETAIL_FAULT_VENDOR_STAGES=Object.freeze(['CAMC','OEM','MEPC','IOT']);

// Snapshot disappearance is an inferred closure, never verified completion.
// Inputs are already filtered to the caller's authorized active Store Master scope.
export function summarizeDisappearedFaultTickets(previousTickets,currentTickets){
 const key=t=>`${String(t.store_code??'').trim().toUpperCase()}|${String(t.ticket_no??'').trim().toUpperCase()}`;
 const current=new Set(currentTickets.map(key)),seen=new Set(),byCategory=new Map(),byState=new Map();
 for(const ticket of previousTickets){
  const id=key(ticket);
  if(!String(ticket.ticket_no??'').trim()||!String(ticket.store_code??'').trim()||current.has(id)||seen.has(id))continue;
  seen.add(id);
  const category=String(ticket.category||'Unspecified').trim()||'Unspecified';
  const state=String(ticket.operational_state_code||'').trim().toUpperCase();
  byCategory.set(category,(byCategory.get(category)||0)+1);
  if(state)byState.set(state,(byState.get(state)||0)+1);
 }
 const byCount=(a,b)=>b.count-a.count||String(a.category||a.state).localeCompare(String(b.category||b.state));
 return {count:seen.size,by_category:[...byCategory].map(([category,count])=>({category,count})).sort(byCount),
  by_state:[...byState].map(([state,count])=>({state,count})).sort(byCount)};
}
