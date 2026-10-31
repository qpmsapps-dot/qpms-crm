import { createElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, ScanLine, Phone, Sparkles, GraduationCap, Users, Download, ArrowUpRight } from 'lucide-react';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { useAuth } from '../../context/auth-context.js';
import { canAccessRoute } from '../../utils/authRoles.js';
import { authenticatedApiRequest } from '../../services/api.js';
import { indiaToday } from '../../../backend/shared/retailAttendance.js';
import { REPORTING_STATES, reportingRows, reportingPeriod, callWindow, selectRows, sum, percent } from './ifmsDashboardModel.js';
import { Metric, StateTable, OperationsRing } from './IfmsDashboardParts.jsx';
import './ifmsDashboard.css';

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
    <header className="ifms-page-header"><div><p className="ifms-eyebrow">Reliance Retail / Dashboard</p><h1>South Zone – IFMS Operations Summary</h1><p>This Month Till Today</p>{canAccessRoute(user,'/reliance-retail/store-master')&&<Link to="/reliance-retail/store-master">Open Store, Zone, FO, AOP and Activity Management</Link>}</div><div className="ifms-updated"><span className="ifms-status-dot"/>Last Updated: {data?.updated_at?new Date(data.updated_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'awaiting data'}</div></header>
    <div className="ifms-toolbar"><div className="ifms-toolbar-filters"><StateFilter label="Global reporting state" value={global} onChange={value => { setGlobal(value); setLocal({}); }}/><label className="ifms-month"><CalendarDays size={16}/><span className="sr-only">Reporting month</span><input aria-label="Reporting month" type="month" min="2000-01" max="9999-12" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}/></label><span className="ifms-date-range">{period.label}</span></div><button disabled={!data} onClick={()=>void exportSummary()}><Download size={15}/> Export summary</button></div>
    <p className="ifms-data-status" role="status">{inventory.status === 'loading' ? 'Loading authorized module data…' : inventory.status === 'unavailable' ? `Module data unavailable: ${inventory.error}` : 'Authorized Store Master and available operational sources connected. Unconfigured modules remain unavailable.'}</p>
    {inventory.status==='ready'&&inventory.error&&<p role="alert" className="ifms-note">{inventory.error}</p>}
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
