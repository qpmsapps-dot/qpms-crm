export const OOS_STAGES=['QUOTED','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED'];
export const FAULT_STAGES=['REGISTERED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'];
const required=(data,keys)=>{for(const key of keys)if(!String(data[key]??'').trim())throw Error(`${key} is required.`);};
export function validateServiceAction(order,action,data={}){
 if(action==='REWORK'){if(order.kind!=='OOS'||order.status!=='QUOTED')throw Error('Rework is allowed before PO only.');required(data,['reason','quotation_file_sha256']);return order.status;}
 if(action==='ESCALATE'){if(order.kind!=='FAULT'||order.status==='CLOSED')throw Error('Only open faults can be escalated.');required(data,['reason']);return order.status;}
 const stages=order.kind==='OOS'?OOS_STAGES:FAULT_STAGES,next=stages[stages.indexOf(order.status)+1];
 if(!next||action!==next)throw Error('Only the next forward workflow stage is allowed.');
 const fields={PO_RECORDED:['po_number','po_date'],COMMERCIALLY_CONFIRMED:['confirmation_ref'],FUND_RECORDED:['fund_ref'],PAYMENT_RECORDED:['payment_ref'],DELIVERED:['delivery_ref','delivery_date'],ASSIGNED:['assigned_profile_id'],IN_PROGRESS:['remarks'],RESOLVED:['resolution','closure_evidence_ref'],CLOSED:['closure_evidence_ref']};
 required(data,fields[next]||[]);return next;
}

export const SERVICE_STAGE_LABELS={QUOTED:'Quot Shared \u2014 Waiting for PO',PO_RECORDED:'Commercial Confirmation',COMMERCIALLY_CONFIRMED:'PO Received \u2014 Fund Yet to Raise',FUND_RECORDED:'Fund recorded',PAYMENT_RECORDED:'Payment recorded',DELIVERED:'Delivered'};
