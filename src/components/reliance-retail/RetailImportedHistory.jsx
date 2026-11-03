import {useEffect,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {useAuth} from '../../context/auth-context.js';
import {isPlatformAdmin} from '../../utils/authRoles.js';

const FIELDS={
 cmpm:[['cm_status','CM status'],['pm_status','PM status'],['store_name','Store']],
 thermography:[['scheduled_date','Scheduled'],['report_submission_status','Report status'],['store_name','Store']],
 deep_cleaning:[['scheduled_date','Scheduled'],['completed_date','Completed'],['cleaning_status','Source status']],
 technical_training:[['employee_code','Employee Code'],['employee_name','Employee'],['training_date','Training date'],['topics','Topics']],
 soft_skill_training:[['employee_code','Employee Code'],['employee_name','Employee'],['training_date','Training date'],['topics','Topics']],
 shortage:[['total_shortage','Shortage'],['frequency','Frequency'],['store_name','Store']],
 manpower_vacancy:[['position','Vacant position'],['vacant_count','Vacancies'],['vacant_from','Vacant from']],
 oos_historical:[['quotation_no','Quotation'],['po_number','PO'],['quotation_status','Quotation status'],['work_status','Work status'],['amount','Amount']]
};
const STATES=['TN','KA','KL','TG','AP-1','AP-2'];
const labelState=value=>value==='KA'?'KA / KN':value;
const display=value=>{
 if(value==null||value==='')return '—';
 if(Array.isArray(value))return value.map(display).join(', ');
 if(typeof value==='object')return JSON.stringify(value);
 return String(value);
};
export default function RetailImportedHistory({module,title,month='2026-10'}){
 const {user}=useAuth();
 const canRead=isPlatformAdmin(user);
 const [state,setState]=useState(''),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[match,setMatch]=useState('');
 const [page,setPage]=useState(1),[result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const enabled=canRead&&month==='2026-10'&&Boolean(FIELDS[module]);
 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  queueMicrotask(()=>{if(active){setLoading(true);setError('');setResult(null);}});
  authenticatedApiRequest({url:'/api/reliance-retail/module-reports/ifms-history',
   params:{module,month,state,q:search,match_status:match,page,limit:25}
  }).then(r=>{if(active)setResult(r.data?.report||null);})
   .catch(e=>{if(active)setError(e.response?.data?.message||'Unable to load historical Excel records.');})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[enabled,module,month,state,search,match,page]);
 if(!enabled)return null;
 const items=result?.rows||[];
 const fields=FIELDS[module]||[];
 const total=result?.total||0;
 return <section className="retail-report-panel" aria-label={`${title||module} October Excel source rows`}>
  <div className="retail-report-panel-heading">
   <div><h2>{title||'October Excel'} — imported October records</h2>
    <p className="retail-report-description">Original IFMS snapshot: 28 October 2026. Reference data only, not FO-verified work or approved financial transactions.</p></div>
   <span>{loading?'Loading…':`${total.toLocaleString('en-IN')} source rows`}</span>
  </div>
  <form className="retail-report-filters" onSubmit={e=>{e.preventDefault();setPage(1);setSearch(query.trim());}}>
   <label>State<select aria-label={`${module} source state`} value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>
    <option value="">All states</option>{STATES.map(s=><option key={s} value={s}>{labelState(s)}</option>)}
   </select></label>
   <label>Store Code<input type="search" aria-label={`${module} source store search`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Store Code"/></label>
   <label>Store Master match<select aria-label={`${module} source match`} value={match} onChange={e=>{setMatch(e.target.value);setPage(1);}}>
     <option value="">All source records</option><option value="MATCHED">Matched stores</option>
     <option value="NOT_IN_MASTER">Not in Store Master</option><option value="STATE_MISMATCH">State conflict</option>
     <option value="NO_STORE_CODE">No Store Code</option>
   </select></label>
   <button type="submit">Search</button>
  </form>
  {error&&<p role="alert" className="retail-report-description">{error}</p>}
  {!loading&&!error&&total===0&&<p className="retail-report-description">No historical source rows match these filters.</p>}
  {!!items.length&&<div role="region" className="retail-report-table" aria-label={`${module} historical imported table`} tabIndex={0}><table>
   <thead><tr><th>State / Store Code</th><th>Source date</th><th>Reported status</th>
    {fields.map(([k,l])=><th key={k}>{l}</th>)}<th>Store match / Source</th></tr></thead>
   <tbody>{items.map(row=><tr key={row.id}>
    <td><strong>{row.reporting_state}</strong><p>{row.store_code||'Not recorded'}</p></td>
    <td>{row.record_date||'Not dated'}</td>
    <td>{row.status||'Not recorded'}</td>
    {fields.map(([key])=><td key={key}>{display(row.data?.[key])}</td>)}
    <td>{row.match_status==='MATCHED'?'Matched to Store Master':row.match_status==='NO_STORE_CODE'?'Employee-level / No Store Code':row.match_status==='NOT_IN_MASTER'?'Store Code not in Master':'Identity conflict'}
     <details><summary>Source details</summary><div className="max-w-xs text-xs">{Object.entries(row.data||{}).map(([k,v])=><p key={k}><strong>{k.replaceAll('_',' ')}:</strong> {display(v)}</p>)}<p>Excel row: {row.source_row}</p></div></details>
    </td>
   </tr>)}</tbody>
  </table></div>}
  <div className="flex flex-wrap items-center justify-end gap-3 p-3 text-xs">
   <span>Page {page} of {Math.max(1,Math.ceil(total/25))}</span>
   <button type="button" disabled={page<=1||loading} onClick={()=>setPage(n=>Math.max(1,n-1))}>Previous</button>
   <button type="button" disabled={loading||page*25>=total} onClick={()=>setPage(n=>n+1)}>Next</button>
  </div>
  <p className="retail-report-description">All original dates are retained. Unmatched Store Codes are excluded from canonical operational totals pending reconciliation; these historical rows cannot update live work status.</p>
 </section>;
}
