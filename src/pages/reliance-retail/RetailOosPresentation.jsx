import {useEffect,useRef,useState} from 'react';
import {stageLabel} from './retailOosModel.js';
import {oosMoney,sourceDecimal} from '../../utils/oosDecimal.js';

export function OosWorkflowBadge({version}){
 const label=version===1?'Legacy':version===2?'12-Stage':'Workflow unavailable';
 return <span className={'oos-workflow-badge '+(version===1?'oos-workflow-legacy':version===2?'oos-workflow-twelve':'oos-workflow-unknown')} aria-label={'Workflow: '+label}>{label}</span>;
}

export function OosDrawer({title,busy,onClose,children}){
 const dialog=useRef(null),[expanded,setExpanded]=useState(false);
 useEffect(()=>{
  const node=dialog.current,previous=document.activeElement,overflow=document.body.style.overflow;
  node.showModal();document.body.style.overflow='hidden';
  return()=>{node.close();document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 const dismiss=()=>{if(!busy&&!dialog.current.querySelector('[aria-busy="true"]')&&!dialog.current.querySelector('.oos-overlay'))onClose();};
 return <dialog ref={dialog} className={'oos-drawer'+(expanded?' oos-drawer-expanded':'')} aria-label={title} onCancel={e=>{e.preventDefault();dismiss();}}>
  <div className="oos-drawer-header"><h2>{title}</h2><div className="oos-actions"><button aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Reduce drawer':'Expand drawer'}</button><button disabled={busy} onClick={dismiss}>Close drawer</button></div></div>
  <div className="oos-drawer-body">{children}</div>
 </dialog>;
}

export function OosFinancialSummary({order}){
 const totals=order.original_items?.[0]?.quotation_header?.totals;
 const value=key=>totals?.numeric_text?.[key]??totals?.[key];
 const fee=sourceDecimal(value('management_fees'));
 const rows=[['Taxable amount',value('taxable_amount')],['GST',value('total_gst')],...(fee!==null&&!/^0+(\.0+)?$/.test(String(fee))?[['Management fees',fee]]:[]),['Final quotation amount',order.amount]];
 return <section aria-label="Financial summary"><h3>Financial summary — original quotation</h3><dl className="oos-detail-summary oos-financial-summary">{rows.map(([label,amount])=><div key={label}><dt>{label}</dt><dd>{oosMoney(amount)}</dd></div>)}</dl><p className="oos-note">Source quotation values, including any applicable fees. Missing amounts remain unavailable.</p></section>;
}

const readable=key=>key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const display=value=>typeof value==='boolean'?(value?'Yes':'No'):String(value);
export function OosAuditEvent({event:e,reference,children}){
 const evidence=e.evidence||{},fields=evidence.fields||{};
 const facts={...fields,...evidence};
 const keys=['reason','remarks','from_status','to_status','confirmation_ref','confirming_person_name','confirming_department','confirmation_date','confirmation_reference','confirmation_status','confirmation_authenticity','system_actor_capacity','system_actor_role','system_actor_employee_code','verification_status','recorded_by','recorded_as'];
 const date=e.created_at&&new Date(e.created_at);
 return <article className="oos-history">
  <strong>{reference&&`${reference} · `}{readable(stageLabel(e.action||'Unknown action'))}</strong>
  <p>Actor: {e.actor_name||e.actor_id||'Unavailable'}</p>
  <p><time dateTime={e.created_at}>{date&&Number.isFinite(date.valueOf())?date.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Date unavailable'}</time> · Asia/Kolkata · Revision {e.after_value?.revision??e.evidence?.revision??e.revision??'Unavailable'}</p>
  <dl className="oos-detail-summary">{keys.filter(key=>facts[key]!=null&&typeof facts[key]!=='object').map(key=><div key={key}><dt>{readable(key)}</dt><dd>{key.endsWith('status')?stageLabel(display(facts[key])):key==='confirmation_authenticity'&&facts[key]==='MIS_SUBMITTED_UNVERIFIED'?'MIS submitted / unverified':display(facts[key])}</dd></div>)}</dl>
  {children}
 </article>;
}
