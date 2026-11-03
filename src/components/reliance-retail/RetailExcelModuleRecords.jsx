import {useEffect,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {useAuth} from '../../context/auth-context.js';
import {isPlatformAdmin} from '../../utils/authRoles.js';
import './retailExcelModuleRecords.css';

const CONFIG={
 cmpm:{title:'CM / PM October Excel',fields:[['store_name','Store'],['cm_status','CM (1–15)'],['pm_status','PM (16–end)'],['remarks','Remarks']]},
 thermography:{title:'Thermography October Excel',fields:[['store_name','Store'],['scheduled_date','Scheduled'],['report_submission_status','Report'],['report_submitted_date','Report date'],['completion_status','Completion'],['completed_date','Completed']]},
 deep_cleaning:{title:'Deep Cleaning October Excel',fields:[['store_name','Store'],['frequency','Frequency'],['scheduled_date','Scheduled'],['completed_date','Completed'],['cleaning_status','Excel status'],['remarks','Remarks']]},
 technical_training:{title:'MEPC Training October Excel',fields:[['employee_code','Scrum ID'],['employee_name','Employee'],['designation','Designation'],['training_status','Excel status'],['training_date','Date'],['topics','Topics']]},
 soft_skill_training:{title:'HK Training October Excel',fields:[['employee_code','Scrum ID'],['employee_name','Employee'],['designation','Designation'],['training_status','Excel status'],['training_date','Date'],['topics','Topics']]},
 shortage:{title:'Manpower Shortage October Excel',fields:[['store_name','Store'],['hk_total','HK budget'],['total_shortage','Reported shortage'],['frequency','Frequency']]},
 manpower_vacancy:{title:'Manpower Vacancy October Excel',fields:[['position','Position'],['vacant_count','Vacancies'],['vacant_from','Vacant from'],['remarks','Remarks']]},
 oos_historical:{title:'OOS October Excel Tracker',fields:[['quotation_no','Quotation'],['quotation_date','Quote date'],['po_number','PO number'],['work_description','Work description'],['documents_status','Documents'],['amount','Amount']]}
};
const moduleLabel=module=>CONFIG[module]?.title||module;
const STRATEGY='Historical Excel-reported data. These entries are not verified FO submissions, client approvals, OOS12 workflow transitions or posted financial transactions.';
const renderValue=v=>v==null||v===''?'—':typeof v==='object'?Object.entries(v).map(([k,x])=>k+': '+x).join('; '):String(v);
export default function RetailExcelModuleRecords({modules=['cmpm'],defaultModule}){
 const {user}=useAuth(),allowed=isPlatformAdmin(user);
 const first=defaultModule&&modules.includes(defaultModule)?defaultModule:modules[0];
 const [module,setModule]=useState(first),[state,setState]=useState(''),[draft,setDraft]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!allowed||!CONFIG[module])return;
  let active=true;
  queueMicrotask(()=>{if(active){setBusy(true);setError('');}});
  authenticatedApiRequest({url:'/api/reliance-retail/module-reports/excel/'+module,
   params:{month:'2026-10',state,search,page,limit:25}})
   .then(response=>{if(active)setData(response.data?.result||null);})
   .catch(e=>{if(active){setData(null);setError(e.response?.data?.message||e.message);}})
   .finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[allowed,module,state,search,page]);
 if(!allowed)return null;
 const c=CONFIG[module]||CONFIG[modules[0]];
 const rows=data?.rows||[],total=data?.total||0;
 const pages=Math.max(1,Math.ceil(total/25));
 return <section className="ifms-excel-module" aria-label="October Excel source records" id={'october-excel-'+module}>
  <header className="ifms-excel-header">
   <div><p className="ifms-excel-eyebrow">Reliance Retail · Imported source rows</p>
    <h2>{c.title}</h2><p>October 28, 2026 snapshot · Actual worksheet rows · Read-only</p></div>
   <span className="ifms-excel-tag">Excel-reported</span>
  </header>
  <p className="ifms-excel-warning">{STRATEGY}</p>
  <div className="ifms-excel-controls">
   {modules.length>1&&<label>Excel section<select aria-label="October Excel section" value={module} onChange={e=>{setModule(e.target.value);setPage(1);setSearch('');setDraft('');}}>
    {modules.map(k=><option value={k} key={k}>{moduleLabel(k)}</option>)}</select></label>}
   <label>State<select aria-label="Excel source state" value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>
    <option value="">All states</option>{['TN','KA','KL','TG','AP-1','AP-2'].map(k=><option value={k} key={k}>{k}</option>)}</select></label>
   <form onSubmit={e=>{e.preventDefault();setSearch(draft);setPage(1);}}>
    <label>Find Store / Employee / Quotation<input aria-label="Search Excel source records" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Store Code, Scrum ID, PO or quotation"/></label>
    <button type="submit">Search</button>
    {search&&<button type="button" onClick={()=>{setDraft('');setSearch('');setPage(1);}}>Clear</button>}
   </form>
  </div>
  {busy&&<p role="status">Loading October Excel records…</p>}
  {error&&<p role="alert" className="ifms-excel-error">{error}</p>}
  <p className="ifms-excel-count">{total.toLocaleString('en-IN')} matching source rows. Store identities not found in Store Master remain flagged, not reassigned.</p>
  <div className="ifms-excel-scroll" role="region" aria-label={c.title+' source table'} tabIndex={0}>
   <table><thead><tr><th scope="col">Excel row</th><th scope="col">State</th><th scope="col">Store Code</th>
    {c.fields.map(([key,label])=><th key={key} scope="col">{label}</th>)}
    <th scope="col">Store mapping</th><th scope="col">All source fields</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.id}>
    <td>{r.source_row}</td><td>{r.state}</td><td>{r.store_code||'—'}</td>
    {c.fields.map(([key])=><td key={key} title={renderValue(r.data?.[key])}>{renderValue(r.data?.[key])}</td>)}
    <td>{r.match_status==='MATCHED'?'Matched':r.match_status?.replaceAll('_',' ')}</td>
    <td><details><summary>View source</summary>
     <dl>{Object.entries(r.data||{}).map(([key,value])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{renderValue(value)}</dd></div>)}</dl>
    </details></td>
   </tr>)}</tbody></table>
   {!busy&&!error&&!rows.length&&<p className="ifms-excel-empty">No Excel source rows match these filters.</p>}
  </div>
  <div className="ifms-excel-pagination">
   <span>Page {page} of {pages}</span>
   <button disabled={busy||page<=1} onClick={()=>setPage(x=>Math.max(1,x-1))}>Previous</button>
   <button disabled={busy||page>=pages} onClick={()=>setPage(x=>Math.min(pages,x+1))}>Next</button>
  </div>
 </section>;
}
