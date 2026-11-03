import { createElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, ScanLine, Phone, Sparkles, GraduationCap, Users, Download, ArrowUpRight } from 'lucide-react';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { useAuth } from '../../context/auth-context.js';
import { canAccessRoute,isPlatformAdmin } from '../../utils/authRoles.js';
import { authenticatedApiRequest } from '../../services/api.js';
import { indiaToday } from '../../../backend/shared/retailAttendance.js';
import { REPORTING_STATES, reportingRows, reportingPeriod, callWindow, selectRows, sum, percent } from './ifmsDashboardModel.js';
import { Metric, StateTable, OperationsRing } from './IfmsDashboardParts.jsx';
import './ifmsDashboard.css';
import RetailOosDashboard from './RetailOosDashboard.jsx';

const modules = [
  { id: 'attendance', title: 'Attendance', icon: ClipboardCheck, color: '#16a875', route: '/reliance-retail/attendance' },
  { id: 'thermography', title: 'Thermography', icon: ScanLine, color: '#9254de', route: '/reliance-retail/thermography' },
  { id: 'cm', title: 'CM Calls', icon: Phone, color: '#1677ff', route: '/reliance-retail/cmpm' },
  { id: 'pm', title: 'PM Calls', icon: Phone, color: '#ee861b', route: '/reliance-retail/cmpm' },
  { id: 'cleaning', title: 'Deep Cleaning', icon: Sparkles, color: '#16a875', route: '/reliance-retail/deep-cleaning' },
  { id: 'technical', title: 'MEPC Training', icon: GraduationCap, color: '#1677ff', route: '/reliance-retail/training' },
  { id: 'soft', title: 'HK Training', icon: Users, color: '#ed3d82', route: '/reliance-retail/training' },
];
function StateFilter({ label, value, onChange, global = '' }) {
  return <label className="ifms-filter"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)}><option value="">All States</option>{REPORTING_STATES.map(state => <option key={state.code} value={state.code} disabled={Boolean(global && global !== state.code)}>{state.label}</option>)}</select></label>;
}
function ModuleBody({ id, rows, stores, storeStatus, source }) {
  const total = field => sum(rows, field);
  if(source?.status!=='ready')return <p className="ifms-note" role="status">{source?.reason || 'Loading authorized module data…'} Totals unavailable.</p>;
  if (id === 'attendance') return <>
    <div className="ifms-metrics"><Metric label="HK credits" value={total('hk_actual')}/><Metric label="MEPC credits" value={total('mepc_actual')}/><Metric label="Attendance %" value={rows.length&&rows.every(r=>r.complete)&&total('total_target')>0?`${percent(total('total_actual'),total('total_target'))}%`:'N/A'}/><Metric label="Total Man-Days" value={total('total_actual')}/></div>
    <div className="ifms-card-content"><p className="ifms-note">Targets use approved effective-dated Store Master AOP, including decimals. Missing coverage or AOP yields N/A; it is not employee absence.</p><StateTable rows={rows.map(r=>({...r,presentPct:r.overall_pct==null?null:Math.round(r.overall_pct*100)/100}))} columns={[{ key: 'presentPct', label: 'Attendance %', bar: true, percentage: true }]}/></div>
  </>;
  if (id === 'technical' || id === 'soft') return <>
    <div className="ifms-card-content ifms-training"><div><Metric label="Trainings completed" value={total('completed')}/><div className="ifms-store-total"><Metric label="Total stores" value={storeStatus === 'ready' ? stores.length : '—'}/></div></div><StateTable rows={rows} columns={[{ key: 'completed', label: 'Trainings' }]}/></div>
    <p className="ifms-note">Completed {id==='technical'?'MEPC':'HK'} sessions in the selected period. Total stores: {storeStatus === 'ready' ? 'authorized inventory, not trained stores' : 'unavailable'}.</p>
  </>;
  if(id==='thermography'){
    const scheduled=total('scheduled'),awaiting=total('awaiting'),approved=total('approved');
    return <>
      <div className="ifms-metrics"><Metric label="Scheduled" value={scheduled}/><Metric label="Awaiting approval" value={awaiting}/><Metric label="Client Approved" value={approved}/><Metric label="Approval overdue" value={total('overdue')}/></div>
      <div className="ifms-card-content ifms-thermography-content"><OperationsRing total={scheduled+awaiting+approved} segments={[{label:'Scheduled',value:scheduled,color:'#cbd5e1'},{label:'Completed awaiting approval',value:awaiting,color:'#e6ae2e'},{label:'Client Approved',value:approved,color:'var(--module-color)'}]} label="Inspections"/><StateTable rows={rows} columns={[{key:'scheduled',label:'Scheduled'},{key:'awaiting',label:'Awaiting'},{key:'approved',label:'Approved'},{key:'overdue',label:'Overdue'}]}/></div>
      <p className="ifms-note">Approval due within 10 calendar days of completion. Late approvals retained: {total('approved_late')}. Overdue is a subset of awaiting approval.</p>
    </>;
  }
  const scans = id === 'thermography';
  const cleaning = id === 'cleaning';
  const denominator = scans ? total('normal') + total('notNormal') : total(cleaning ? 'scheduled' : 'eligible');
  const completed = total(scans ? 'normal' : 'completed');
  const remaining = scans ? total('notNormal') : Math.max(0, denominator - completed);
  const first = scans ? 'Normal' : 'Completed';
  const second = scans ? 'Not Normal' : 'Remaining';
  return <>
    <div className="ifms-metrics"><Metric label={scans ? 'Total scans' : cleaning ? 'Scheduled' : 'Applicable stores'} value={denominator}/><Metric label={first} value={completed}/><Metric label={second} value={remaining}/>{!scans && <Metric label="Completion" value={denominator>0?`${percent(completed, denominator)}%`:'N/A'}/>}</div>
    <div className="ifms-card-content"><OperationsRing total={denominator} segments={[{ label: first, value: completed, color: 'var(--module-color)' }, { label: second, value: remaining, color: scans ? '#f05269' : cleaning ? '#e6ae2e' : '#cbd5e1' }]} label={scans ? 'Scans' : cleaning ? 'Scheduled' : 'Stores'}/><StateTable rows={rows} columns={scans ? [{ key: 'normal', label: 'Normal' }, { key: 'notNormal', label: 'Not Normal' }] : [{ key: 'completed', label: first }, { key: 'remaining', label: second }]}/></div>
    <p className="ifms-note">{cleaning?`Recorded Not Completed: ${total('not_completed')}; Scheduled and pending: ${total('pending')}.`: 'Actual recorded operational results.'}</p>
  </>;
}
const historicalModules=[
 ['cmpm','CM / PM',m=>`CM ${m.cm_completed??0} · PM ${m.pm_completed??0}`],
 ['thermography','Thermography',m=>`Submitted ${m.report_submitted??0} · Pending ${m.report_pending??0}`],
 ['deep_cleaning','Deep Cleaning',m=>`Done ${m.completed??0} · Pending ${m.pending??0}`],
 ['technical_training','MEPC Training',m=>`Done ${m.completed??0} · Pending ${m.pending??0}`],
 ['soft_skill_training','HK Training',m=>`Done ${m.completed??0} · Pending ${m.pending??0}`],
 ['shortage','Manpower Shortage',m=>`Reported shortage ${m.reported_shortage_total??0}`],
 ['manpower_vacancy','Manpower Vacancy',m=>`Vacancies ${m.vacancies_reported??0}`],
 ['oos_historical','OOS Excel Tracker',m=>`PO references ${m.po_referenced??0}`],
];
function HistoricalIfmsSummary({snapshot,globalState}){
 if(snapshot?.status!=='ready'||!Array.isArray(snapshot.rows)||!snapshot.rows.length)return null;
 const states=REPORTING_STATES.filter(s=>!globalState||s.code===globalState);
 const rows=snapshot.rows;
 const format=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 return <section aria-label="Historical October Excel report" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
   <div><h2 className="text-base font-bold text-blue-950">October 2026 — Historical IFMS Excel report</h2>
    <p className="text-xs text-slate-600">Source snapshot: 28 October 2026. Excel-reported figures only; not verified mobile submissions or live workflow status.</p></div>
   <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Historical · read-only</span>
  </div>
  <div className="overflow-x-auto rounded-lg border border-slate-200">
   <table className="w-full min-w-[790px] text-left text-xs">
    <thead className="bg-slate-100 text-slate-700"><tr><th scope="col" className="sticky left-0 min-w-[150px] bg-slate-100 p-2.5">Excel module</th>
     {states.map(state=><th key={state.code} scope="col" className="min-w-[105px] p-2.5">{state.code}</th>)}
     <th scope="col" className="p-2.5 text-right">Reported rows</th></tr></thead>
    <tbody>{historicalModules.map(([key,title,render])=>{
     const found=rows.filter(r=>r.module===key);
     return <tr key={key} className="border-t border-slate-200">
      <th scope="row" className="sticky left-0 bg-white p-2.5 font-semibold text-slate-800">{title}</th>
      {states.map(state=>{
       const record=found.find(r=>r.state===state.code);
       return <td key={state.code} className="p-2.5 align-top">{record?<div><strong className="font-semibold text-blue-900">{format(record.source_rows)} rows</strong>
        <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{render(record.metrics||{})}</div></div>:<span className="text-slate-400">—</span>}</td>;
      })}
      <td className="p-2.5 text-right font-semibold text-blue-950">{format(found.filter(r=>!globalState||r.state===globalState).reduce((a,r)=>a+r.source_rows,0))}</td>
     </tr>;
    })}</tbody>
   </table>
  </div>
  <p className="mt-2 text-[11px] leading-5 text-slate-600">Store rows may repeat, especially CM/PM and OOS. OOS amounts and stages are historical source figures only and do not create active quotations, payments or approvals. This report does not change the live KPI cards above.</p>
 </section>;
}

export default function RetailDashboard() {
  usePageTitle('South Zone – IFMS Operations Summary');
  const { user } = useAuth();
  const today = indiaToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [global, setGlobal] = useState('');
  const [local, setLocal] = useState({});
  const [inventory, setInventory] = useState({ status: 'loading', rows: [], error: '' });
  const [data,setData]=useState(null);
  const period = reportingPeriod(month, today);
  useEffect(() => {
    let live = true;
    queueMicrotask(()=>{if(live){setData(null);setInventory({status:'loading',rows:[],error:''});}});
    const end=reportingPeriod(month,indiaToday()).end;
    if(!end){queueMicrotask(()=>{if(live)setInventory({status:'unavailable',rows:[],error:'Upcoming reporting month'});});return()=>{live=false;};}
    authenticatedApiRequest({url:'/api/reliance-retail/module-reports/dashboard',params:{from:month+'-01',to:end}}).then(response => {
      if (!live) return;
      const report=response.data.report,stores=report?.stores;
      if (!Array.isArray(stores)) throw new Error('Authorized store inventory unavailable');
      setData(report);
      setInventory({ status: 'ready', rows: reportingRows(stores), error: '' });
    }).catch(error => { if (live) setInventory({ status: 'unavailable', rows: [], error: error.response?.data?.message || error.message }); });
    return () => { live = false; };
  }, [month]);
  async function exportSummary(){try{const {default:ExcelJS}=await import('exceljs'),{downloadUnified}=await import('../../utils/retailUnifiedExport.js'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Module summary');sheet.addRow(['Module','State','From','To','Availability','HK Credits','MEPC Credits','Attendance Target','Completed','Scheduled','Not Completed','Pending','Note']);for(const module of modules){const source=data.modules[module.id],rows=selectRows(source?.rows||[],global,local[module.id]||'');if(source?.status!=='ready'){sheet.addRow([module.title,global||local[module.id]||'',data.from,data.to,'Unavailable',null,null,null,null,null,null,null,source?.reason]);continue;}for(const r of rows)sheet.addRow([module.title,r.state,data.from,data.to,'Available',r.hk_actual??null,r.mepc_actual??null,r.complete?r.total_target:null,r.completed??null,r.scheduled??null,r.not_completed??null,r.pending??null]);}await downloadUnified(book,'Retail_Operations_Summary.xlsx');}catch(e){setInventory(v=>({...v,error:e.message}));}}
  return <div className="ifms-dashboard">
    <header className="ifms-page-header"><div><p className="ifms-eyebrow">Reliance Retail / Dashboard</p><h1>South Zone – IFMS Operations Summary</h1><p>This Month Till Today</p>{isPlatformAdmin(user)&&<Link to="/reliance-retail/store-master">Admin: Store Management</Link>}</div><div className="ifms-updated"><span className="ifms-status-dot"/>Last Updated: {data?.updated_at?new Date(data.updated_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'awaiting data'}</div></header>
    <div className="ifms-toolbar"><div className="ifms-toolbar-filters"><StateFilter label="Global reporting state" value={global} onChange={value => { setGlobal(value); setLocal({}); }}/><label className="ifms-month"><CalendarDays size={16}/><span className="sr-only">Reporting month</span><input aria-label="Reporting month" type="month" min="2000-01" max="9999-12" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}/></label><span className="ifms-date-range">{period.label}</span></div><button disabled={!data} onClick={()=>void exportSummary()}><Download size={15}/> Export summary</button></div>
    <p className="ifms-data-status" role="status">{inventory.status === 'loading' ? 'Loading reports…' : inventory.status === 'unavailable' ? `Reports unavailable: ${inventory.error}` : 'Showing available reports for the selected period.'}</p>
    {inventory.status==='ready'&&inventory.error&&<p role="alert" className="ifms-note">{inventory.error}</p>}
    <RetailOosDashboard globalState={global}/>
    {data?.historical_ifms?.status==='ready'&&<HistoricalIfmsSummary snapshot={data.historical_ifms} globalState={global}/>}
    <div className="ifms-grid">{modules.map(({ id, title, icon: Icon, color, route }, index) => {
      const source=data?.modules[id];
      const rows = selectRows(source?.rows||[], global, local[id] || '');
      const stores = selectRows(inventory.rows, global, local[id] || '');
      const window = id === 'cm' || id === 'pm' ? callWindow(month, id, today) : null;
      return <section key={id} className={`ifms-card ${index < 4 ? 'ifms-wide' : 'ifms-third'}`} style={{ '--module-color': color }} aria-labelledby={`ifms-${id}`}>
        <div className="ifms-card-header"><div className="ifms-card-heading"><span className="ifms-icon">{createElement(Icon, { size: 21 })}</span><div><h2 id={`ifms-${id}`}>{title}</h2><p>{window ? window.label : 'This Month Till Today'}</p></div></div><StateFilter label={`${title} reporting state`} value={local[id] || ''} global={global} onChange={value => setLocal(previous => ({ ...previous, [id]: value }))}/></div>
        {window && <p className="ifms-window">{window.status} · All applicable stores due by {window.endLabel}</p>}
        <ModuleBody id={id} rows={rows} stores={stores} storeStatus={inventory.status} source={source}/>
        {!!source?.identity_exceptions&&<p className="ifms-note">{source.identity_exceptions} source records excluded from totals for unresolved store identity or category.</p>}
        <footer className="ifms-card-footer"><span>{global || local[id] ? REPORTING_STATES.find(state => state.code === (global || local[id]))?.label : 'All six reporting states'}</span>{route && canAccessRoute(user, route) && <Link to={route}>View Details <ArrowUpRight size={13}/></Link>}</footer>
      </section>;
    })}</div>
  </div>;
}
