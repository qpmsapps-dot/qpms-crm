import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {authenticatedApiRequest} from '../../services/api.js';
import {registerRows,filterRegister,matrix,ageBand,indiaDate} from './retailOosModel.js';
import './retailOosWorkspace.css';
const api=async path=>(await authenticatedApiRequest({url:'/api/reliance-retail/mis'+path})).data.result;
const drills=(state,status,month)=>'/reliance-retail/mis/oos?'+new URLSearchParams({state,status,month}).toString();
export function OosMatrix({report,month='',state=''}) {
 const [view,setView]=useState('count'),[today,setToday]=useState(indiaDate());
 useEffect(()=>{const timer=setInterval(()=>setToday(indiaDate()),60000);return()=>clearInterval(timer);},[]);
 const states=[...new Set((report.states||[]).map(s=>s==='PY'?'TN':s))].filter(s=>!state||s===state);
 // Only active 12-stage orders are represented. Immutable retired/legacy history
 // remains in the register audit but must never appear as an active pipeline count.
 const rows=filterRegister(registerRows(report,today),{month,state}).filter(r=>r.workflow_version===2&&!r.retired);
 const model=matrix(rows,states);
 const active=report.twelve_stage_available??report.twelve_stage_enabled;
 const stateTotal=s=>model.cells.reduce((n,r)=>n+r.states[s].count,0);
 return <section className="oos-workspace oos-panel oos-compact" aria-label="OOS Status Dashboard">
  <header className="oos-compact-header">
   <h3>OOS Status <small>12-stage workflow</small></h3>
   <div className="oos-actions" aria-label="OOS matrix display">
    <button aria-pressed={view==='count'} onClick={()=>setView('count')}>Count View</button>
    <button aria-pressed={view==='age'} onClick={()=>setView('age')}>Ageing View</button>
   </div>
  </header>
  <div className="oos-compact-scroll" role="region" aria-label="Scrollable OOS status matrix" tabIndex={0}>
   <table className="oos-compact-table" aria-label="Twelve-stage OOS state matrix">
    <thead><tr><th scope="col">OOS Status</th>{states.map(s=><th scope="col" key={s}>{s}</th>)}<th scope="col">Total</th></tr></thead>
    <tbody>{model.cells.map((row,index)=><tr key={row.code}>
     <th scope="row"><span className="oos-compact-index">{String(index+1).padStart(2,'0')}</span>{row.code==='OOS12_DOCUMENT_SUBMITTED'?'Documents submitted / pending':row.label}</th>
     {states.map(s=>{const c=row.states[s];return <td key={s}><Link
      className={'oos-compact-cell'+(view==='age'&&c.count?' age-'+ageBand(c.average):'')}
      to={drills(s,row.code,month)}
      title={`${s} · ${row.label} · ${c.count} quotation(s); maximum ${c.max??'unknown'} days; overdue ${c.overdue}`}>
      <strong>{view==='count'?(c.count||'—'):(c.average==null?'—':`${c.average}d`)}</strong>
      <small>Max {c.max??'—'}d · Overdue {c.overdue} · Unknown {c.unknown}</small>
     </Link></td>;})}
     <td className="oos-compact-total">{states.reduce((n,s)=>n+row.states[s].count,0)}</td>
    </tr>)}</tbody>
    <tfoot><tr><th scope="row">Total quotations</th>{states.map(s=><td key={s}>{stateTotal(s)}</td>)}<td>{states.reduce((n,s)=>n+stateTotal(s),0)}</td></tr></tfoot>
   </table>
  </div>
  {!active&&<p className="oos-compact-note" role="status">12-stage workflow is not yet active. Only verified 12-stage quotations are counted; retired legacy uploads are excluded.</p>}
 </section>;
}
export default function RetailOosDashboard({globalState=''}) {
 const [month,setMonth]=useState(''),[report,setReport]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;api('/access').then(a=>{if(!a.active||!['MIS_OOS','CENTRAL_MIS'].includes(a.role))throw Error('OOS reporting access is not assigned.');return api('/oos/register');}).then(r=>{if(!r.complete)throw Error('Complete OOS register unavailable.');if(live)setReport(r);}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);});return()=>{live=false;};},[]);
 return <section aria-label="State-wise OOS reporting"><div className="oos-dashboard-period"><h2>OOS Tracker</h2><label>OOS reporting period<select aria-label="OOS reporting period" value={month?'month':'all'} onChange={e=>setMonth(e.target.value==='all'?'':indiaDate().slice(0,7))}><option value="all">All-Time</option><option value="month">Selected month</option></select></label>{month&&<input aria-label="OOS reporting month" type="month" value={month} onChange={e=>setMonth(e.target.value)}/>}</div>{error?<p role="status">OOS totals unavailable: {error}</p>:!report?<p role="status">Verifying authorized OOS reports…</p>:<OosMatrix report={report} month={month} state={globalState}/>}</section>;
}
