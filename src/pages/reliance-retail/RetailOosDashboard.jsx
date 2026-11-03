import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {authenticatedApiRequest} from '../../services/api.js';
import {OOS12,LEGACY_LABELS,registerRows,filterRegister,matrix,ageBand,indiaDate} from './retailOosModel.js';
import './retailOosWorkspace.css';
const api=async path=>(await authenticatedApiRequest({url:'/api/reliance-retail/mis'+path})).data.result;
const drills=(state,status,month)=>'/reliance-retail/mis/oos?'+new URLSearchParams({state,status,month}).toString();
export function OosMatrix({report,month='',state=''}) {
 const [view,setView]=useState('count'),[today,setToday]=useState(indiaDate());
 useEffect(()=>{const timer=setInterval(()=>setToday(indiaDate()),60000);return()=>clearInterval(timer);},[]);
 const states=[...new Set((report.states||[]).map(s=>s==='PY'?'TN':s))].filter(s=>!state||s===state),all=registerRows(report,today),rows=filterRegister(all,{month,state});
 const available=report.twelve_stage_available??report.twelve_stage_enabled;
 const model=matrix(rows,states),legacy=rows.filter(r=>r.workflow_version!==2&&!r.retired);
 const active=rows.filter(r=>!r.retired),overdue=active.filter(r=>r.status_age!=null&&r.status_age>7).length;
 const stages=OOS12.map(([code,label],index)=>({code,label:code==='OOS12_DOCUMENT_SUBMITTED'?'Documents submitted / pending':label,step:index+1,count:active.filter(r=>r.workflow_version===2&&r.status===code).length}));
 const activeTwelve=stages.reduce((sum,stage)=>sum+stage.count,0);
 const pendingDocuments=active.filter(r=>r.workflow_version===2&&r.details?.documents_pending===true).length;
 const legacyStages=Object.entries(LEGACY_LABELS),legacyMatrix=matrix(legacy,states,legacyStages);
 const summary=[['Waiting for PO',OOS12[0][0],'QUOTED'],['PO received, fund not raised',OOS12[2][0],'COMMERCIALLY_CONFIRMED'],['Work done, documents pending',OOS12[7][0]],['Documents received, JMS pending',OOS12[9][0]],['JMS created, invoice pending',OOS12[10][0]]];
 function table(cells,label,unavailable=false){return <div className="oos-table-scroll"><table aria-label={label}><thead><tr><th>OOS Status</th>{states.map(s=><th key={s}>{s}</th>)}<th>Total</th></tr></thead><tbody>{cells.map(row=><tr key={row.code}><th>{row.code==='OOS12_DOCUMENT_SUBMITTED'?'Documents submitted / pending':row.label}</th>{states.map(s=>{const c=row.states[s];return <td key={s}><Link className={'oos-matrix-cell age-'+(view==='age'?ageBand(c.average):'plain')} to={drills(s,row.code,month)} title={`Count ${c.count}; average ${c.average??'unavailable'} days; maximum ${c.max??'unavailable'} days; over 7 days ${c.overdue}; missing dates ${c.unknown}`}>
 {unavailable?'—':view==='count'?c.count:c.average==null?'—':`${c.average}d`}{!unavailable&&<small>Max {c.max??'—'}d · Overdue {c.overdue} · Unknown {c.unknown}</small>}</Link></td>;})}<td>{unavailable?'—':states.reduce((n,s)=>n+row.states[s].count,0)}</td></tr>)}</tbody><tfoot><tr><th>State totals (quotations)</th>{states.map(s=><td key={s}>{unavailable?'—':cells.reduce((n,r)=>n+r.states[s].count,0)}</td>)}<td>{unavailable?'—':cells.reduce((n,r)=>n+states.reduce((v,s)=>v+r.states[s].count,0),0)}</td></tr></tfoot></table></div>;}
 return <section className="oos-workspace oos-panel" aria-label="OOS Status Dashboard"><header><div><h2>OOS Status Dashboard</h2><p>One quotation, one current status, one verified state.</p></div><div className="oos-actions"><button aria-pressed={view==='count'} onClick={()=>setView('count')}>Count View</button><button aria-pressed={view==='age'} onClick={()=>setView('age')}>Ageing View</button></div></header>
 <p className="oos-board-method">Month uses the original quotation date (India time). All-Time includes records with unknown dates; ageing is calculated as of {today}.</p>
 {!available&&<p className="oos-warning">The twelve-stage workflow is installed but not active. Existing six-stage quotations remain visible separately below.</p>}
 <div className="oos-board-hero">
  <div><p className="oos-board-eyebrow">RELIANCE RETAIL · OOS PIPELINE</p><h3>Quotation-to-invoice overview</h3><p>Live records by current stage and state. Select any stage to open the matching quotation register.</p></div>
  <div className="oos-board-stats">
   <div><span>All current quotations</span><strong>{active.length}</strong></div>
   <div><span>12-stage quotations</span><strong>{available?activeTwelve:'—'}</strong></div>
   <div><span>Over 7 days in stage</span><strong>{overdue}</strong></div>
   <div><span>Documents still pending</span><strong>{available?pendingDocuments:'—'}</strong></div>
  </div>
 </div>
 <section className="oos-stage-board" aria-label="Twelve-stage quotation pipeline">
  {stages.map(item=>available?<Link key={item.code} className="oos-stage-tile" to={drills(state,item.code,month)}>
   <span className="oos-stage-step">STAGE {String(item.step).padStart(2,'0')}</span>
   <strong>{item.count}</strong><span>{item.label}</span>
   <small>View quotations</small>
  </Link>:<div key={item.code} className="oos-stage-tile oos-stage-disabled" aria-disabled="true">
   <span className="oos-stage-step">STAGE {String(item.step).padStart(2,'0')}</span>
   <strong>—</strong><span>{item.label}</span><small>Activation pending</small>
  </div>)}
 </section>
 <h3 className="oos-matrix-heading">State-wise 12-stage status matrix</h3>
 {table(model.cells,'Twelve-stage OOS state matrix',!available)}
 {(legacy.length>0||!available)&&<><h3>Existing six-stage workflow</h3>{table(legacyMatrix.cells,'Legacy OOS state matrix')}</>}
 <div className="oos-overdue-grid">{summary.map(([label,code,legacyCode])=><article key={code}><h3>{label}</h3><strong>{!available&&!legacyCode?'Unavailable':rows.filter(r=>!r.retired&&(r.status===code||r.status===legacyCode)&&r.status_age>7).length}</strong><p>Current status over 7 days</p></article>)}</div>
 <p>{rows.filter(r=>!r.retired&&!r.state).length} unresolved/cross-state quotations excluded from matrix. Retired quotations excluded. Missing status dates do not contribute to average/max or overdue totals.</p>
 </section>;
}
export default function RetailOosDashboard({globalState=''}) {
 const [month,setMonth]=useState(''),[report,setReport]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;api('/access').then(a=>{if(!a.active||!['MIS_OOS','CENTRAL_MIS'].includes(a.role))throw Error('OOS reporting access is not assigned.');return api('/oos/register');}).then(r=>{if(!r.complete)throw Error('Complete OOS register unavailable.');if(live)setReport(r);}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);});return()=>{live=false;};},[]);
 return <section aria-label="State-wise OOS reporting"><div className="oos-dashboard-period"><h2>State-wise OOS reporting</h2><label>OOS reporting period<select aria-label="OOS reporting period" value={month?'month':'all'} onChange={e=>setMonth(e.target.value==='all'?'':indiaDate().slice(0,7))}><option value="all">All-Time</option><option value="month">Selected month</option></select></label>{month&&<input aria-label="OOS reporting month" type="month" value={month} onChange={e=>setMonth(e.target.value)}/>}</div>{error?<p role="status">OOS totals unavailable: {error}</p>:!report?<p role="status">Verifying authorized OOS reports…</p>:<OosMatrix report={report} month={month} state={globalState}/>}</section>;
}
