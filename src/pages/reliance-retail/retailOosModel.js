// Read-only presentation model. Never infers workflow authority from labels.
import {retailOosState} from '../../../backend/shared/retailMisAccess.js';
import {sourceDecimal,sumDecimals} from '../../utils/oosDecimal.js';
export const OOS12 = [
 ['OOS12_QUOTATION_SHARED','Quotation Shared – Waiting for PO'],
 ['OOS12_PO_PENDING_COMMERCIAL','PO Pending Commercial Confirmation'],
 ['OOS12_PO_RECEIVED','PO Received – Fund Yet to Raise'],
 ['OOS12_FUND_RAISED','Fund Raised – Yet to Receive'],
 ['OOS12_FUND_DELIVERED','Fund Delivered'],
 ['OOS12_FUND_RECEIVED','Fund Received – Work Yet to Start'],
 ['OOS12_WIP','WIP – Work in Progress'],
 ['OOS12_WORK_DONE','Work Done – Document Pending'],
 ['OOS12_DOCUMENT_SUBMITTED','Document Submitted'],
 ['OOS12_DOCUMENT_RECEIVED','Document Received – JMS Yet to Be Created'],
 ['OOS12_JMS_CREATED','JMS Created – Invoice Yet to Raise'],
 ['OOS12_INVOICE_RAISED','Invoice Raised'],
];
export const LEGACY_LABELS = {QUOTED:OOS12[0][1],PO_RECORDED:OOS12[1][1],COMMERCIALLY_CONFIRMED:OOS12[2][1],FUND_RECORDED:'Legacy: Fund recorded',PAYMENT_RECORDED:'Legacy: Payment recorded',DELIVERED:'Legacy: Delivered'};
export const stageLabel = code => LEGACY_LABELS[code] || OOS12.find(s=>s[0]===code)?.[1] || code;
export const AGE_BANDS = [{max:3,name:'green'},{max:7,name:'amber'},{max:15,name:'orange'},{max:Infinity,name:'red'}];
export function indiaDate(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function validDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?value:null;
}
export function timestampDate(value) {if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value))return null;const d=new Date(value);return Number.isFinite(d.valueOf())?indiaDate(d):null;}
export function daysSince(date,today=indiaDate()) {if(!validDate(date)||!validDate(today)||date>today)return null;return Math.round((Date.parse(today)-Date.parse(date))/86400000);}
export const ageBand = days => days==null?'unknown':AGE_BANDS.find(b=>days<=b.max)?.name||'unknown';
function originalFinancial(items) {
 if(!Array.isArray(items)||!items.length)return null;
 const totals=items[0]?.quotation_header?.totals;
 const header=sourceDecimal(totals?.numeric_text?.total_amount??totals?.total_amount);if(header!==null)return header;
 return sumDecimals(items.map(i=>i.numeric_text?.total_amount??i.total_amount));
}
export function registerRows(report,today=indiaDate()) {
 const seen=new Set();return (report?.rows||[]).filter(r=>{if(!r.id||seen.has(r.id))return false;seen.add(r.id);return true;}).map(r=>{
  const originals=r.original_items;
  const quotationDate=validDate(originals?.[0]?.quotation_header?.quotation_date);
  const poDate=validDate(r.original_po_date);
  const statusDate=timestampDate(r.status_entered_at);
  const stores=r.mapped_stores||[];
  const states=[...new Set(stores.map(s=>retailOosState(s.state)).filter(Boolean))];
  // The live workflow forbids cross-state orders. Corrupt/multi-state records are explicit exceptions.
  const state=states.length===1&&stores.length===new Set(r.store_ids||stores.map(s=>s.id)).size?states[0]:null;
  return {...r,state,store_codes:[...new Set(stores.map(s=>s.store_code))],store_names:[...new Set(stores.map(s=>s.store_name).filter(Boolean))],
   quotation_date:quotationDate,po_date:poDate,po_number:r.original_po_number||r.details?.po_number||'',status_date:statusDate,
   amount:originalFinancial(originals),quotation_age:daysSince(quotationDate,today),po_age:daysSince(poDate,today),status_age:daysSince(statusDate,today),
   warnings:[!quotationDate?'Original quotation date missing or invalid; upload date is not substituted.':null,quotationDate>today?'Quotation date is in the future.':null,
    r.details?.po_number&&!poDate?'Original PO receipt date missing or invalid.':null,poDate>today?'PO receipt date is in the future.':null,
    !statusDate?'Immutable current-status timestamp unavailable.':null,statusDate>today?'Status timestamp is in the future.':null,
    !state?'Canonical store/state attribution is unavailable or spans multiple states; excluded from matrix.':null,
    originalFinancial(originals)===null?'Original financial amount unavailable.':null].filter(Boolean)};
 });
}
export function filterRegister(rows,f={}) {
 return rows.filter(r=>(!f.state||r.state===retailOosState(f.state))&&(!f.status||(f.status==='RETIRED'?r.retired:!r.retired&&r.status===f.status))&&
  (!f.month||r.quotation_date?.slice(0,7)===f.month)&&(!f.from||r.quotation_date>=f.from)&&(!f.to||r.quotation_date&&r.quotation_date<=f.to)&&
  (!f.age||(f.age==='unknown'?r[f.ageField||'status_age']==null:ageBand(r[f.ageField||'status_age'])===f.age))&&
  (!f.search||[r.reference,r.po_number,...r.store_codes].join(' ').toLowerCase().includes(f.search.trim().toLowerCase())));
}
export function sortRegister(rows,key='updated_at',direction='desc') {
 return [...rows].sort((a,b)=>{const x=a[key],y=b[key];if(x==null)return y==null?0:1;if(y==null)return -1;return (typeof x==='number'?x-y:String(x).localeCompare(String(y)))*(direction==='asc'?1:-1)||String(a.id).localeCompare(String(b.id));});
}
export function matrix(rows,states,stages=OOS12) {
 const active=rows.filter(r=>!r.retired&&states.includes(r.state));
 const cells=stages.map(([code,label])=>({code,label,states:Object.fromEntries(states.map(state=>{
  const list=active.filter(r=>r.status===code&&r.state===state),ages=list.map(r=>r.status_age).filter(n=>n!==null);
  return [state,{count:list.length,average:ages.length?Math.round(ages.reduce((a,b)=>a+b,0)/ages.length*10)/10:null,max:ages.length?Math.max(...ages):null,overdue:ages.filter(n=>n>7).length,unknown:list.length-ages.length}];
 }))}));return {cells,exceptions:rows.filter(r=>!r.retired&&(!r.state||!stages.some(s=>s[0]===r.status))).length};
}
export function kpis(rows) {const a=rows.filter(r=>!r.retired);return [a.length,a.filter(r=>['QUOTED',OOS12[0][0]].includes(r.status)).length,a.filter(r=>r.workflow_version===2&&r.status===OOS12[6][0]).length,a.filter(r=>r.workflow_version===2&&r.status===OOS12[11][0]).length];}
