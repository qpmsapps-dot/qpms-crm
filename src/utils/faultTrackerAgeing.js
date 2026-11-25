import {RETAIL_FAULT_STAGES} from '../../backend/shared/retailFaultWorkflow.js';

export const AGEING_COLUMNS = ['0–3','4–7','8–15','16–30','31–60','61–90','>90','Unknown'];
export const AGEING_REGIONS = [['TN','TN & PY'],['KL','KL'],['KN','KA'],['TG','TG'],['AP1','AP-1'],['AP2','AP-2']];
export function ageingRegion(ticket) {
 const code=String(ticket.groupedState||'').trim().toUpperCase();
 return ({PY:'TN','TN+PY':'TN','TN & PY':'TN',KA:'KN',TS:'TG','AP-1':'AP1','AP-2':'AP2'})[code]||code;
}
export function ageingValue(ticket) {
 const raw=Object.hasOwn(ticket,'ageingSourceDays')?ticket.ageingSourceDays:ticket.ageingDays;
 if(raw==null||String(raw).trim()==='')return null;
 const days=Number(raw);
 return Number.isFinite(days)&&days>=0?days:null;
}
export function ageingBand(ticket) {
 const d=ageingValue(ticket);
 if(d===null)return 'Unknown';
 return AGEING_COLUMNS[[3,7,15,30,60,90,Infinity].findIndex(limit=>d<=limit)];
}
export function summarizeAgeing(label,tickets) {
 const bands=Object.fromEntries(AGEING_COLUMNS.map(key=>[key,0]));
 let known=0,sum=0,oldest=null;
 for(const ticket of tickets){
  bands[ageingBand(ticket)]++;
  const d=ageingValue(ticket);
  if(d!==null){known++;sum+=d;oldest=oldest===null?d:Math.max(oldest,d);}
 }
 return {label,tickets,total:tickets.length,bands,average:known?Math.round(sum/known*10)/10:null,oldest};
}
export function buildAgeingReports(tickets,selectedState='') {
 const scoped=selectedState?tickets.filter(t=>ageingRegion(t)===selectedState):tickets;
 const stages=RETAIL_FAULT_STAGES.map(stage=>summarizeAgeing(stage,scoped.filter(t=>t.ifmsStage===stage)));
 const other=scoped.filter(t=>!RETAIL_FAULT_STAGES.includes(t.ifmsStage));
 if(other.length)stages.push(summarizeAgeing('Unmapped / source stage',other));
 stages.push(summarizeAgeing('Grand Total',scoped));
 const states=AGEING_REGIONS.map(([code,label])=>summarizeAgeing(label,tickets.filter(t=>ageingRegion(t)===code)));
 const unassigned=tickets.filter(t=>!AGEING_REGIONS.some(([code])=>code===ageingRegion(t)));
 if(unassigned.length)states.push(summarizeAgeing('Other / unmapped region',unassigned));
 states.push(summarizeAgeing('South Total',tickets));
 return {stages,states};
}
export function ageingExportRows(rows,compact=false) {
 const headers=compact?['Region','Total','0–30','31–60','61–90','>90','Unknown','Avg. days','Oldest']:['IFMS stage','Total',...AGEING_COLUMNS,'Avg. days','Oldest'];
 return [headers,...rows.map(r=>[r.label,r.total,...(compact?[AGEING_COLUMNS.slice(0,4).reduce((n,k)=>n+r.bands[k],0),...AGEING_COLUMNS.slice(4).map(k=>r.bands[k])]:AGEING_COLUMNS.map(k=>r.bands[k])),r.average,r.oldest])];
}
