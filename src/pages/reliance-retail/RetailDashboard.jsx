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
const EXCEL_MODULE_IDS={thermography:'thermography',cm:'cmpm',pm:'cmpm',cleaning:'deep_cleaning',technical:'technical_training',soft:'soft_skill_training'};
function ExcelModuleBody({id,rows}){
 if(!rows.length)return <p className="ifms-note">No reported Excel rows for the selected state. This does not indicate verified absence.</p>;
 const sourceRows=rows.reduce((s,r)=>s+Number(r.source_rows||0),0);
 const total=field=>rows.reduce((s,r)=>s+Number(r.metrics?.[field]||0),0);
 let fields=[];
 if(id==='cm')fields=[['cm_completed','CM completed'],['cm_pending','Pending'],['cm_unreported','No status']];
 else if(id==='pm')fields=[['pm_completed','PM completed'],['pm_pending','Pending'],['pm_unreported','No status']];
 else if(id==='thermography')fields=[['report_submitted','Submitted'],['report_pending','Pending'],['report_not_submitted','Not submitted']];
 else if(id==='cleaning')fields=[['completed','Completed'],['pending','Pending'],['cancelled_or_closed','Cancelled / closed']];
 else fields=[['completed','Completed'],['pending','Pending'],['not_attended','Not attended']];
 const stateRows=rows.map(r=>({state:r.state,excel_rows:r.source_rows,...r.metrics}));
 return <>
  <div className="ifms-metrics"><Metric label="Excel source rows" value={sourceRows}/>{fields.slice(0,3).map(([key,label])=><Metric key={key} label={label} value={total(key)}/>)}</div>
  <div className="ifms-card-content"><StateTable rows={stateRows} columns={[{key:'excel_rows',label:'Source rows'},...fields.map(([key,label])=>({key,label}))]}/></div>
  <p className="ifms-note">Excel reported on 28 Oct 2026; source rows can repeat and do not certify work or evidence. Open View Details for every imported row.</p>
 </>;
}
const EXTRA_EXCEL=[
 {module:'shortage',title:'Manpower Shortage',route:'/reliance-retail/manpower',metric:'reported_shortage_total',metricTitle:'Reported shortage'},
 {module:'manpower_vacancy',title:'Manpower Vacancy',route:'/reliance-retail/manpower',metric:'vacancies_reported',metricTitle:'Vacancies'},
 {module:'oos_historical',title:'OOS Excel Tracker',route:'/reliance-retail/mis/oos',metric:'po_referenced',metricTitle:'PO references'},
];
function ExtraExcelCards({rows,global}){
 return <div className="ifms-excel-extra" aria-label="October Excel manpower and OOS module summaries">
  {EXTRA_EXCEL.map(info=>{
   const matching=rows.filter(row=>row.module===info.module&&(!global||row.state===global));
   const n=field=>matching.reduce((sum,r)=>sum+Number(field==='source_rows'?r.source_rows:r.metrics?.[field]||0),0);
   return <section className="ifms-excel-extra-card" key={info.module}>
    <h2>{info.title}</h2><p className="ifms-excel-extra-number">{n('source_rows').toLocaleString('en-IN')} <small>Excel rows</small></p>
    <p>{info.metricTitle}: <strong>{n(info.metric).toLocaleString('en-IN',{maximumFractionDigits:2})}</strong></p>
    <Link to={info.route}>View imported source records <ArrowUpRight size={13}/></Link>
   </section>;
  })}
 </div>;
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
  const [sourceMode,setSourceMode]=useState('excel');
  const period = reportingPeriod(month, today);
  const excelReady=month==='2026-10'&&isPlatformAdmin(user)&&data?.historical_ifms?.status==='ready';
  const excelMode=Boolean(excelReady&&sourceMode==='excel');
  const historicalRows=data?.historical_ifms?.rows||[];
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
  async function exportSummary(){try{
 const {default:ExcelJS}=await import('exceljs'),{downloadUnified}=await import('../../utils/retailUnifiedExport.js'),book=new ExcelJS.Workbook();
 if(excelMode){
  const sheet=book.addWorksheet('October Excel reported');
  sheet.addRow(['Module','State','Snapshot date','Source rows','Distinct Store Codes','Source type','Metrics JSON']);
  for(const r of historicalRows.filter(row=>!global||row.state===global))sheet.addRow([r.module,r.state,r.snapshot_date,r.source_rows,r.distinct_store_codes,'Excel-reported / unverified',JSON.stringify(r.metrics)]);
  await downloadUnified(book,'Retail_October_2026_Excel_Source_Summary.xlsx');
 }else{
  const sheet=book.addWorksheet('Verified module summary');
  sheet.addRow(['Module','State','From','To','Availability','HK Credits','MEPC Credits','Attendance Target','Completed','Scheduled','Not Completed','Pending','Note']);
  for(const module of modules){const source=data.modules[module.id],rows=selectRows(source?.rows||[],global,local[module.id]||'');if(source?.status!=='ready'){sheet.addRow([module.title,global||local[module.id]||'',data.from,data.to,'Unavailable',null,null,null,null,null,null,null,source?.reason]);continue;}for(const r of rows)sheet.addRow([module.title,r.state,data.from,data.to,'Available',r.hk_actual??null,r.mepc_actual??null,r.complete?r.total_target:null,r.completed??null,r.scheduled??null,r.not_completed??null,r.pending??null]);}
  await downloadUnified(book,'Retail_Operations_Summary.xlsx');
 }
 }catch(e){setInventory(v=>({...v,error:e.message}));}}
  return <div className="ifms-dashboard">
    <header className="ifms-page-header"><div><p className="ifms-eyebrow">Reliance Retail / Dashboard</p><h1>South Zone – IFMS Operations Summary</h1><p>This Month Till Today</p>{isPlatformAdmin(user)&&<Link to="/reliance-retail/store-master">Admin: Store Management</Link>}</div><div className="ifms-updated"><span className="ifms-status-dot"/>Last Updated: {data?.updated_at?new Date(data.updated_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'awaiting data'}</div></header>
    <div className="ifms-toolbar"><div className="ifms-toolbar-filters"><StateFilter label="Global reporting state" value={global} onChange={value => { setGlobal(value); setLocal({}); }}/><label className="ifms-month"><CalendarDays size={16}/><span className="sr-only">Reporting month</span><input aria-label="Reporting month" type="month" min="2000-01" max="9999-12" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}/></label><span className="ifms-date-range">{period.label}</span></div><button disabled={!data} onClick={()=>void exportSummary()}><Download size={15}/> Export summary</button></div>
    <p className="ifms-data-status" role="status">{inventory.status === 'loading' ? 'Loading reports…' : inventory.status === 'unavailable' ? `Reports unavailable: ${inventory.error}` : 'Showing available reports for the selected period.'}</p>
    {inventory.status==='ready'&&inventory.error&&<p role="alert" className="ifms-note">{inventory.error}</p>}
    {excelReady&&<div className="ifms-source-mode" role="group" aria-label="October reporting source">
      <span>October reporting:</span>
      <button aria-pressed={excelMode} onClick={()=>setSourceMode('excel')}>Imported October Excel</button>
      <button aria-pressed={!excelMode} onClick={()=>setSourceMode('verified')}>Verified App Records</button>
      <small>{excelMode?'Excel reported as of 28 October; inspect imported rows under each module.':'Only verified operational submissions and app records.'}</small>
    </div>}
    {!excelMode&&<RetailOosDashboard globalState={global}/>}
    <div className="ifms-grid">{modules.map(({ id, title, icon: Icon, color, route }, index) => {
      const source=data?.modules[id];
      const rows = selectRows(source?.rows||[], global, local[id] || '');
      const stores = selectRows(inventory.rows, global, local[id] || '');
      const window = id === 'cm' || id === 'pm' ? callWindow(month, id, today) : null;
      return <section key={id} className={`ifms-card ${index < 4 ? 'ifms-wide' : 'ifms-third'}`} style={{ '--module-color': color }} aria-labelledby={`ifms-${id}`}>
        <div className="ifms-card-header"><div className="ifms-card-heading"><span className="ifms-icon">{createElement(Icon, { size: 21 })}</span><div><h2 id={`ifms-${id}`}>{title}</h2><p>{excelMode&&id!=='attendance'?'Imported October 28 Excel':window?window.label:'This Month Till Today'}</p></div></div><StateFilter label={`${title} reporting state`} value={local[id] || ''} global={global} onChange={value => setLocal(previous => ({ ...previous, [id]: value }))}/></div>
        {!excelMode&&window&&<p className="ifms-window">{window.status} · All applicable stores due by {window.endLabel}</p>}
        {excelMode&&id!=='attendance'?<ExcelModuleBody id={id} rows={selectRows(historicalRows.filter(r=>r.module===EXCEL_MODULE_IDS[id]),global,local[id]||'')}/>:<ModuleBody id={id} rows={rows} stores={stores} storeStatus={inventory.status} source={source}/>}
        {!excelMode&&!!source?.identity_exceptions&&<p className="ifms-note">{source.identity_exceptions} source records excluded from totals for unresolved store identity or category.</p>}
        <footer className="ifms-card-footer"><span>{global || local[id] ? REPORTING_STATES.find(state => state.code === (global || local[id]))?.label : 'All six reporting states'}</span>{route && canAccessRoute(user, route) && <Link to={route}>View Details <ArrowUpRight size={13}/></Link>}</footer>
      </section>;
    })}</div>
    {excelMode&&<ExtraExcelCards rows={historicalRows} global={global}/>}
  </div>;
}
