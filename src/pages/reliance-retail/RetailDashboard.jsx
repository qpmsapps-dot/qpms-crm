import { createElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, ScanLine, Phone, Sparkles, GraduationCap, Users, Download, ArrowUpRight } from 'lucide-react';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { useAuth } from '../../context/auth-context.js';
import { canAccessRoute } from '../../utils/authRoles.js';
import { relianceRetailApi } from '../../services/relianceRetailApi.js';
import { indiaToday } from '../../../backend/shared/retailAttendance.js';
import { REPORTING_STATES, reportingRows, reportingPeriod, callWindow, emptyOperations, selectRows, sum, percent } from './ifmsDashboardModel.js';
import { Metric, StateTable, OperationsRing, AttendanceTrend } from './IfmsDashboardParts.jsx';
import './ifmsDashboard.css';

const modules = [
  { id: 'attendance', title: 'Attendance', icon: ClipboardCheck, color: '#16a875', route: '/reliance-retail/attendance' },
  { id: 'thermography', title: 'Thermography', icon: ScanLine, color: '#9254de' },
  { id: 'cm', title: 'CM Calls', icon: Phone, color: '#1677ff' },
  { id: 'pm', title: 'PM Calls', icon: Phone, color: '#ee861b' },
  { id: 'cleaning', title: 'Deep Cleaning', icon: Sparkles, color: '#16a875', route: '/reliance-retail/deep-cleaning' },
  { id: 'technical', title: 'Technical Training', icon: GraduationCap, color: '#1677ff', route: '/reliance-retail/training' },
  { id: 'soft', title: 'Soft Skill Training', icon: Users, color: '#ed3d82' },
];
function StateFilter({ label, value, onChange, global = '' }) {
  return <label className="ifms-filter"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)}><option value="">All States</option>{REPORTING_STATES.map(state => <option key={state.code} value={state.code} disabled={Boolean(global && global !== state.code)}>{state.label}</option>)}</select></label>;
}
function ModuleBody({ id, rows, stores, storeStatus }) {
  const total = field => sum(rows, field);
  if (id === 'attendance') return <>
    <div className="ifms-metrics"><Metric label="Present" value="0%"/><Metric label="Half Day" value="0%"/><Metric label="Absent" value="0%"/><Metric label="Total Man-Days" value="0"/></div>
    <div className="ifms-card-content"><AttendanceTrend points={[]}/><StateTable rows={rows} columns={[{ key: 'presentPct', label: 'Attendance %', bar: true, percentage: true }]}/></div>
    <p className="ifms-note">No attendance data connected. Percentages await verified status counts and expected employee-days.</p>
  </>;
  if (id === 'technical' || id === 'soft') return <>
    <div className="ifms-card-content ifms-training"><div><Metric label="Trainings completed" value={total('completed')}/><div className="ifms-store-total"><Metric label="Total stores" value={storeStatus === 'ready' ? stores.length : '—'}/></div></div><StateTable rows={rows} columns={[{ key: 'completed', label: 'Trainings' }]}/></div>
    <p className="ifms-note">Training records unavailable. Total stores: {storeStatus === 'ready' ? 'current store inventory, not trained stores' : 'awaiting verified store inventory'}.</p>
  </>;
  const scans = id === 'thermography';
  const cleaning = id === 'cleaning';
  const denominator = scans ? total('normal') + total('notNormal') : total(cleaning ? 'scheduled' : 'eligible');
  const completed = total(scans ? 'normal' : 'completed');
  const remaining = scans ? total('notNormal') : Math.max(0, denominator - completed);
  const first = scans ? 'Normal' : cleaning ? 'Done' : 'Completed';
  const second = scans ? 'Not Normal' : cleaning ? 'Not Done' : 'Remaining';
  return <>
    <div className="ifms-metrics"><Metric label={scans ? 'Total scans' : cleaning ? 'Scheduled' : 'Applicable stores'} value={denominator}/><Metric label={first} value={completed}/><Metric label={second} value={remaining}/>{!scans && <Metric label="Completion" value={`${percent(completed, denominator)}%`}/>}</div>
    <div className="ifms-card-content"><OperationsRing total={denominator} segments={[{ label: first, value: completed, color: 'var(--module-color)' }, { label: second, value: remaining, color: scans ? '#f05269' : cleaning ? '#e6ae2e' : '#cbd5e1' }]} label={scans ? 'Scans' : cleaning ? 'Scheduled' : 'Stores'}/><StateTable rows={rows} columns={scans ? [{ key: 'normal', label: 'Normal' }, { key: 'notNormal', label: 'Not Normal' }] : [{ key: 'completed', label: first }, { key: 'remaining', label: second }]}/></div>
    <p className="ifms-note">{scans ? 'No scan results connected.' : cleaning ? 'No scheduled cleaning data connected.' : 'Eligible stores and unique completed stores unavailable.'} Zero values await data.</p>
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
  const period = reportingPeriod(month, today);
  useEffect(() => {
    let live = true;
    // Only reuse store inventory. Submission totals do not supply the required metrics.
    relianceRetailApi.dashboard({ month }).then(response => {
      if (!live) return;
      const stores = response.dashboard?.stores;
      // The existing endpoint caps inventory at 5,000; a capped result is not complete.
      if (!Array.isArray(stores) || stores.length >= 5000) throw new Error('Complete store inventory unavailable');
      setInventory({ status: 'ready', rows: reportingRows(stores), error: '' });
    }).catch(error => { if (live) setInventory({ status: 'unavailable', rows: [], error: error.response?.data?.message || error.message }); });
    return () => { live = false; };
  }, [month]);
  return <div className="ifms-dashboard">
    <header className="ifms-page-header"><div><p className="ifms-eyebrow">Reliance Retail / Dashboard</p><h1>South Zone – IFMS Operations Summary</h1><p>This Month Till Today</p></div><div className="ifms-updated"><span className="ifms-status-dot"/>Last Updated: awaiting data</div></header>
    <div className="ifms-toolbar"><div className="ifms-toolbar-filters"><StateFilter label="Global reporting state" value={global} onChange={value => { setGlobal(value); setLocal({}); }}/><label className="ifms-month"><CalendarDays size={16}/><span className="sr-only">Reporting month</span><input aria-label="Reporting month" type="month" min="2000-01" max="9999-12" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}/></label><span className="ifms-date-range">{period.label}</span></div><button disabled title="No compatible summary export is available"><Download size={15}/> Export unavailable</button></div>
    <p className="ifms-data-status" role="status">Operational metrics await compatible data. {inventory.status === 'loading' ? 'Loading store inventory…' : inventory.status === 'unavailable' ? `Store inventory unavailable: ${inventory.error}` : 'Store inventory connected.'}</p>
    <div className="ifms-grid">{modules.map(({ id, title, icon: Icon, color, route }, index) => {
      const rows = selectRows(emptyOperations(), global, local[id] || '');
      const stores = selectRows(inventory.rows, global, local[id] || '');
      const window = id === 'cm' || id === 'pm' ? callWindow(month, id, today) : null;
      return <section key={id} className={`ifms-card ${index < 4 ? 'ifms-wide' : 'ifms-third'}`} style={{ '--module-color': color }} aria-labelledby={`ifms-${id}`}>
        <div className="ifms-card-header"><div className="ifms-card-heading"><span className="ifms-icon">{createElement(Icon, { size: 21 })}</span><div><h2 id={`ifms-${id}`}>{title}</h2><p>{window ? window.label : 'This Month Till Today'}</p></div></div><StateFilter label={`${title} reporting state`} value={local[id] || ''} global={global} onChange={value => setLocal(previous => ({ ...previous, [id]: value }))}/></div>
        {window && <p className="ifms-window">{window.status} · All applicable stores due by {window.endLabel}</p>}
        <ModuleBody id={id} rows={rows} stores={stores} storeStatus={inventory.status}/>
        <footer className="ifms-card-footer"><span>{global || local[id] ? REPORTING_STATES.find(state => state.code === (global || local[id]))?.label : 'All six reporting states'}</span>{route && canAccessRoute(user, route) && <Link to={route}>View Details <ArrowUpRight size={13}/></Link>}</footer>
      </section>;
    })}</div>
  </div>;
}
