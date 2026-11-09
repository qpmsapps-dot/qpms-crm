import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ScanLine, Wrench, Settings2, Sparkles, GraduationCap, Download, RefreshCw, Expand, CheckCircle2, AlertTriangle, CalendarDays, Building2, Layers, TrendingUp, Clock3 } from 'lucide-react';
import { useAuth } from '../../context/auth-context.js';
import { canAccessRoute, isPlatformAdmin } from '../../utils/authRoles.js';
import { authenticatedApiRequest } from '../../services/api.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { indiaToday, reportingState } from '../../../backend/shared/retailAttendance.js';
import { reportingPeriod, callWindow } from './ifmsDashboardModel.js';
import { EXECUTIVE_MODULES, EXECUTIVE_STATES, stateName, number, previousPeriod, executiveReport, comparison, sameInventory, executiveConclusion, reportExceptions } from '../../utils/retailExecutiveReport.js';
import { Count, Deferred, Empty, MetricFacts, ModuleLink, ReportBoundary, ReportSection, Reveal, SmallIcon } from '../../components/reliance-retail/ExecutiveReportUi.jsx';
import { CompletionRing, StateBars } from '../../components/reliance-retail/ExecutiveCharts.jsx';
import attendanceWave from '../../assets/retail-kpi/attendance-wave.webp';
import thermographyWave from '../../assets/retail-kpi/thermography-wave.webp';
import cmWave from '../../assets/retail-kpi/cm-wave.webp';
import pmWave from '../../assets/retail-kpi/pm-wave.webp';
import cleaningWave from '../../assets/retail-kpi/deep-cleaning-wave.webp';
import trainingWave from '../../assets/retail-kpi/training-wave.webp';
import ExecutiveAttendanceTrend from '../../components/reliance-retail/ExecutiveAttendanceTrend.jsx';
import './retailExecutive.css';

const ActivityPanel = lazy(() => import('../../components/reliance-retail/ExecutiveActivity.jsx'));
const icons = [Activity, ScanLine, Wrench, Settings2, Sparkles, GraduationCap];
const waves = [attendanceWave, thermographyWave, cmWave, pmWave, cleaningWave, trainingWave];
const storageKey = 'qpms-retail-executive-v3';
const formatTime = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Unavailable';
function savedScope() {
  try { const v = JSON.parse(sessionStorage.getItem(storageKey)); return /^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(v?.month) ? v : {}; } catch { return {}; }
}
function Delta({ value, unit }) {
  return <span className={value > 0 ? 'er-positive' : value < 0 ? 'er-negative' : 'er-muted'}>{value == null ? 'Comparison unavailable' : `${value > 0 ? '+' : ''}${number(value)} ${unit === '%' ? 'pp' : 'count'} vs previous period`}</span>;
}
export default function RetailDashboard() {
  usePageTitle('Reliance Retail - Executive Operations Report');
  const { user } = useAuth(), today = indiaToday();
  const [initial] = useState(savedScope);
  const [month, setMonth] = useState(initial.month || today.slice(0, 7)), [state, setState] = useState(EXECUTIVE_STATES.includes(initial.state) ? initial.state : ''), [store, setStore] = useState(initial.store || '');
  const [cutoff, setCutoff] = useState(initial.cutoff || ''), [refresh, setRefresh] = useState(0), [loaded, setLoaded] = useState(null), [error, setError] = useState(''), [previousError, setPreviousError] = useState('');
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState(''), [selected, setSelected] = useState('attendance'), [attendanceClass, setAttendanceClass] = useState('overall'), [executive, setExecutive] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = useRef(null), scroll = useRef(initial.scroll || 0), restored = useRef(false);
  const period = reportingPeriod(month, today);
  const to = cutoff && cutoff >= period.start && cutoff <= period.end ? cutoff : period.end;
  const requestKey = month + ':' + to;
  const data = loaded?.key === requestKey ? loaded.current : null;
  const previous = loaded?.key === requestKey ? loaded.previous : null;
  const busy = loaded?.key !== requestKey && !error;
  const scope = useMemo(() => ({ month, from: period.start, to, state, store }), [month, period.start, to, state, store]);
  const canOpen = useCallback(route => canAccessRoute(user, route), [user]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = () => setReduced(media.matches); media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    queueMicrotask(() => { if (live) { setError(''); setPreviousError(''); setLoaded(null); } });
    if (!to) { queueMicrotask(() => { if (live) setError('Upcoming reporting period.'); }); return () => { live = false; controller.abort(); }; }
    const prior = previousPeriod(period.start, to);
    const request = params => authenticatedApiRequest({ url: '/api/reliance-retail/module-reports/dashboard', params, signal: controller.signal }).then(r => {
      const report = r.data?.report;
      if (!Array.isArray(report?.stores) || !report.modules || report.from !== params.from || report.to !== params.to) throw Error('Report identity or authorized Store Master inventory is incomplete.');
      return report;
    });
    Promise.allSettled([request({ from: period.start, to }), prior.comparable ? request({ from: prior.from, to: prior.to }) : Promise.reject(Error('Previous month has fewer days; no equal-length comparison.'))]).then(([current, priorResult]) => {
      if (!live) return;
      if (current.status === 'fulfilled') setLoaded({ key: requestKey, current: current.value, previous: priorResult.status === 'fulfilled' ? priorResult.value : null, refreshed: new Date().toISOString() });
      else setError(current.reason.response?.data?.message || current.reason.message);
      if (priorResult.status === 'rejected') setPreviousError(priorResult.reason.response?.data?.message || priorResult.reason.message);
    });
    return () => { live = false; controller.abort(); };
  }, [requestKey, period.start, to, refresh]);
  useEffect(() => {
    if (!data || restored.current) return;
    const target = Number.isFinite(scroll.current) ? Math.max(0, scroll.current) : 0;
    let observer, timer;
    const finish = () => { restored.current = true; observer?.disconnect(); clearTimeout(timer); };
    const restore = () => { window.scrollTo(0, target); if (document.documentElement.scrollHeight - innerHeight >= target - 2) finish(); };
    observer = new ResizeObserver(restore);
    observer.observe(root.current);
    const frame = requestAnimationFrame(restore);
    timer = setTimeout(finish, 5000);
    window.addEventListener('wheel', finish, { once: true });
    window.addEventListener('pointerdown', finish, { once: true });
    return () => { finish(); cancelAnimationFrame(frame); window.removeEventListener('wheel', finish); window.removeEventListener('pointerdown', finish); };
  }, [data]);
  useEffect(() => {
    const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ ...scope, cutoff, scroll: scroll.current })); } catch { /* Storage may be disabled. */ } };
    const remember = () => { scroll.current = window.scrollY; save(); };
    const beforeNavigation = event => { if (event.target.closest?.('a')) remember(); };
    save(); window.addEventListener('pagehide', remember); document.addEventListener('click', beforeNavigation, true);
    return () => { save(); window.removeEventListener('pagehide', remember); document.removeEventListener('click', beforeNavigation, true); };
  }, [scope, cutoff]);
  const model = useMemo(() => executiveReport(data, scope), [data, scope]);
  const priorModel = useMemo(() => executiveReport(previous, scope), [previous, scope]);
  const deltas = useMemo(() => Object.fromEntries(EXECUTIVE_MODULES.map(m => [m.id, comparison(model.modules[m.id], priorModel.modules[m.id], sameInventory(data, previous, scope))])), [model, priorModel, data, previous, scope]);
  const conclusion = executiveConclusion(model, deltas), exceptions = reportExceptions(model);
  const module = EXECUTIVE_MODULES.find(m => m.id === selected), metric = model.modules[selected];
  const allStores = (data?.stores || []).filter(s => !state || reportingState(s.state) === state);
  const attendance = model.modules.attendance, cleaning = model.modules.cleaning, training = model.modules.training;
  function changeMonth(value) { if (/^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(value)) { setMonth(value); setCutoff(''); setStore(''); setError(''); } }
  async function exportSummary() {
    setExporting(true); setExportError('');
    try {
      const { default: ExcelJS } = await import('exceljs'), { downloadUnified } = await import('../../utils/retailUnifiedExport.js');
      const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('State summary');
      sheet.addRow(['Module', 'State', 'From', 'To', 'Source', 'Metric', 'Value', 'Note']);
      for (const row of model.states.filter(r => !state || r.state === state)) for (const m of EXECUTIVE_MODULES) {
        const value = row.modules[m.id];
        sheet.addRow([m.title, stateName(row.state), data.from, data.to, 'Operational', m.note, value.value, value.reason || 'Training has no target denominator.']);
        for (const [key, count] of Object.entries(value.counts)) sheet.addRow([m.title, stateName(row.state), data.from, data.to, 'Operational', key, count]);
      }
      const historical = book.addWorksheet('Historical Excel separate');
      historical.addRow(['State', 'Module', 'Snapshot date', 'Source rows', 'Metrics JSON', 'Source filename', 'Source class']);
      for (const row of data.historical_ifms?.rows || []) if ((!state || reportingState(row.state) === state) && !store) historical.addRow([row.state, row.module, row.snapshot_date || data.historical_ifms.snapshot_date, row.source_rows, JSON.stringify(row.metrics), row.source_filename, 'Excel reported, not FO verified']);
      await downloadUnified(book, 'Retail_Executive_Operations.xlsx');
    } catch (e) { setExportError(e.message); } finally { setExporting(false); }
  }
  async function presentation() {
    setExecutive(v => !v);
    if (!executive && root.current?.requestFullscreen) { try { await root.current.requestFullscreen(); } catch { /* In-page mode remains available. */ } }
    else if (document.fullscreenElement === root.current) await document.exitFullscreen();
  }
  const link = m => <ModuleLink module={m} allowed={canOpen(m.route)} scope={scope} />;
  const visibleStates = model.states.filter(r => !state || r.state === state);
  return <div ref={root} className={'retail-executive' + (executive ? ' er-presentation' : '')} data-motion={reduced ? 'reduced' : 'enabled'}>
    <header className="er-header"><div><p className="er-eyebrow">RELIANCE RETAIL / LEADERSHIP REPORT</p><h1>Reliance Retail — Executive Operations Report</h1><p>South Zone | Cleaning | Housekeeping | MEPC Operations</p></div><div className="er-actions"><button onClick={() => void presentation()} aria-pressed={executive}><Expand size={15} />Executive View</button><button onClick={() => setRefresh(v => v + 1)} disabled={busy}><RefreshCw size={15} />Refresh</button><button onClick={() => void exportSummary()} disabled={!data || exporting}><Download size={15} />{exporting ? 'Exporting...' : 'Export report'}</button></div></header>
    <div className="er-toolbar"><label>Month<input aria-label="Reporting month" type="month" value={month} onChange={e => changeMonth(e.target.value)} /></label><label>From<input aria-label="Reporting from" type="date" readOnly value={period.start} title="Existing endpoint requires month start." /></label><label>To<input aria-label="Reporting to" type="date" value={to || ''} min={period.start} max={period.end || period.start} onChange={e => { setCutoff(e.target.value); setError(''); }} /></label><label>State<select aria-label="Global reporting state" value={state} onChange={e => { setState(e.target.value); setStore(''); }}><option value="">All authorized states</option>{EXECUTIVE_STATES.map(s => <option key={s} value={s}>{stateName(s)}</option>)}</select></label><label>Zone<select aria-label="Reporting zone" disabled title="Zone aggregates are not supplied."><option>Not supplied</option></select></label><label>Store<select aria-label="Reporting store" value={store} onChange={e => setStore(e.target.value)}><option value="">All authorized stores</option>{allStores.map(s => <option key={s.id} value={s.id}>{s.store_code} - {s.store_name}</option>)}</select></label><button onClick={() => { setMonth(today.slice(0, 7)); setCutoff(''); setState(''); setStore(''); setError(''); }}>Reset</button></div>
    <p className="er-scope-note">{period.start} to {to || 'upcoming'} · {stateName(state) || 'All authorized states'} · {model.stores.find(s => s.id === store)?.store_code || (store ? 'Store unavailable' : 'All stores')}. Supported filters transfer to module reports; CM/PM retain their monthly windows. Thermography shows current recorded status of the schedule cohort, not historical cutoff status. Scope is restored on return.</p>
    {store && <p role="status" className="er-alert">Inventory is filtered. Per-store operational aggregates are unavailable; use the existing module's store filter.</p>}
    {busy && <div role="status" className="er-skeleton">Loading authorized executive reports...</div>}{error && <p role="alert" className="er-alert">Reports unavailable: {error}</p>}{exportError && <p role="alert">{exportError}</p>}
    <Reveal><ReportSection number="1" title="Executive Summary" subtitle="Verified operational achievements, without a composite implementation score." className="er-summary"><div className="er-summary-grid">{[[Building2, data ? model.stores.length : null, 'Authorized stores'], [CheckCircle2, cleaning.counts.Completed, 'Deep Cleaning completed'], [GraduationCap, training.counts['HK sessions'], 'HK sessions'], [Layers, training.counts['MEPC sessions'], 'MEPC sessions']].map(([Icon, value, label]) => <div key={label}><SmallIcon icon={Icon} /><strong>{number(value)}</strong><span>{label}</span></div>)}<div className="er-achievement"><TrendingUp /><strong>{conclusion.achievements[0] || 'Comparison pending'}</strong><span>{conclusion.achievements.length ? 'Higher comparable result' : 'No historical improvement established'}</span></div></div></ReportSection></Reveal>
    <Reveal><ReportSection number="2" title="Module Performance Snapshot" subtitle="Open the existing authorized module; no mutation workflows added."><div className="er-kpis">{EXECUTIVE_MODULES.map((m, index) => <Reveal key={m.id} delay={index * 70}><div className={'er-kpi er-kpi-' + m.id} style={{ backgroundImage: `url(${waves[index]})` }}><div className="er-kpi-top"><SmallIcon icon={icons[index]} size={23} /><h3>{m.title}</h3></div><Count value={model.modules[m.id].value} suffix={m.unit} /><p>{m.note}</p><Delta value={deltas[m.id]} unit={m.unit} /><div className="er-kpi-link">{link(m)}</div></div></Reveal>)}</div></ReportSection></Reveal>
    <Reveal><ReportSection number="3" title="Performance Trends & Coverage" subtitle="Approved daily Attendance trend and period completion counts."><div className="er-three"><div className="er-subcard"><ExecutiveAttendanceTrend cutoff={to} state={state} store={store} refresh={refresh} metric={attendanceClass} onMetric={setAttendanceClass} attendance={attendance} reduced={reduced} /></div><div className="er-subcard"><h3>Deep Cleaning Overview</h3><CompletionRing metric={cleaning} title="Completed" reduced={reduced} /><MetricFacts counts={cleaning.counts} /><p className="er-note">{cleaning.reason}</p></div><div className="er-subcard"><h3>Today's Highlights</h3><CalendarDays className="er-large-icon" /><p>{to === today ? 'Today is included in the selected period.' : 'Today is outside this reporting period.'}</p><Empty>Daily store coverage, jobs, sessions and exceptions are not supplied separately. Period totals appear above.</Empty><p className="er-note">Report assembled: {formatTime(data?.updated_at)}. Source observation freshness not supplied.</p></div></div></ReportSection></Reveal>
    <Reveal><ReportSection number="4" title="State-wise Performance Analysis" subtitle="PY reports under TN. KA uses the existing KN reporting key."><div className="er-state-grid"><div className="er-table-scroll"><table><thead><tr><th>State</th><th>Stores</th>{EXECUTIVE_MODULES.map(m => <th key={m.id}>{m.title}</th>)}</tr></thead><tbody>{visibleStates.map(r => <tr key={r.state}><th><button className="er-state-button" onClick={() => { setState(s => s === r.state ? '' : r.state); setStore(''); }}>{stateName(r.state)}</button></th><td>{data ? r.stores : 'N/A'}</td>{EXECUTIVE_MODULES.map(m => <td key={m.id}>{number(r.modules[m.id].value)}{r.modules[m.id].value == null ? '' : m.unit}</td>)}</tr>)}</tbody></table></div><div><h3>State comparison · attendance</h3><StateBars rows={visibleStates} reduced={reduced} /><p className="er-note">Training and currently approved Thermography are counts. Thermography status is current for the selected cohort; it is not reconstructed at the cutoff. Completion rates require valid denominators.</p></div></div></ReportSection></Reveal>
    <Reveal><ReportSection number="5" title="Month-on-Month Performance" subtitle={`Equal elapsed days. Current: ${period.start} to ${to || 'N/A'}; previous: ${previous?.from || 'unavailable'} to ${previous?.to || 'unavailable'}.`}><div className="er-table-scroll"><table><thead><tr><th>Module</th><th>Current</th><th>Previous</th><th>Change</th><th>Coverage</th></tr></thead><tbody>{EXECUTIVE_MODULES.map(m => <tr key={m.id}><th>{m.title}</th><td>{number(model.modules[m.id].value)}{model.modules[m.id].value == null ? '' : m.unit}</td><td>{number(m.id === 'thermography' ? null : priorModel.modules[m.id].value)}{m.id === 'thermography' || priorModel.modules[m.id].value == null ? '' : m.unit}</td><td><Delta value={deltas[m.id]} unit={m.unit} /></td><td>{m.id === 'thermography' ? 'Historical status unavailable; current cohort only' : deltas[m.id] == null ? 'Not comparable / unavailable' : 'Equal days; same authorized store set'}</td></tr>)}</tbody></table></div>{previousError && <p className="er-note">Previous period: {previousError}</p>}<p className="er-note">pp = percentage points, not relative growth. CM: days 1–15. PM: days 16–month-end. The existing reporting windows remain authoritative.</p></ReportSection></Reveal>
    <Deferred><Reveal><ReportSection number="6" title="Module-wise Detailed Performance" subtitle="Existing definitions, AOP policies and module windows remain authoritative." action={link(module)}><div className="er-tabs" role="tablist" aria-label="Detailed performance modules">{EXECUTIVE_MODULES.map(m => <button key={m.id} role="tab" aria-selected={selected === m.id} onClick={() => setSelected(m.id)}>{m.title}</button>)}</div><div className="er-detail-grid"><div><h3>{module.title}</h3><div className="er-period-value">{number(metric.value)}{metric.value == null ? '' : module.unit}<small>{module.note}</small></div><MetricFacts counts={metric.counts} /><p className="er-note">{metric.reason || 'Operational sessions only; no target denominator supplied.'}</p>{['cm', 'pm'].includes(selected) && <p className="er-note">{callWindow(month, selected, today).status}</p>}</div><div><h3>State breakdown</h3><StateBars rows={visibleStates} metric={selected} reduced={reduced} /></div><div><h3>Key takeaways</h3><p><Delta value={deltas[selected]} unit={module.unit} /></p><h4>Pending actions</h4>{exceptions.filter(e => e.id === selected).map(e => <p key={e.label}>{e.label}: <strong>{number(e.count)}</strong></p>)}<h4>Reporting limitations</h4><p className="er-note">{selected === 'training' ? 'Period topics, attendees and photo classification are not supplied. Optional missing attendees are not failures.' : selected === 'attendance' ? 'Credits / approved effective-dated AOP mandays; missing reporting coverage is not absence.' : 'Missing evidence and Not Done are never inferred from remaining tasks.'}</p><p className="er-note">Identity exceptions: {data?.modules?.[selected]?.identity_exceptions ?? 'Not supplied'}. Source freshness: not supplied.</p></div></div><div className="er-related">{isPlatformAdmin(user) && <Link to="/reliance-retail/store-master">Store Management / approved AOP</Link>}<ModuleLink module={{ route: '/reliance-retail/manpower' }} allowed={canOpen('/reliance-retail/manpower')} scope={scope}>Manpower</ModuleLink><ModuleLink module={{ route: '/fault-tracker' }} allowed={canOpen('/fault-tracker')} scope={scope}>Fault Tracker</ModuleLink></div>{data?.historical_ifms && !store && <details className="er-historical"><summary>Historical Excel snapshot · separate reported source</summary><p className="er-note">{data.historical_ifms.snapshot_date || 'Unavailable snapshot'} · Not FO-verified. Never combined with operational KPIs.</p><div className="er-table-scroll"><table><thead><tr><th>State</th><th>Module</th><th>Source rows</th><th>Reported metrics</th></tr></thead><tbody>{(data.historical_ifms.rows || []).filter(r => !state || reportingState(r.state) === state).map((r, i) => <tr key={i}><td>{stateName(r.state)}</td><td>{r.module}</td><td>{number(r.source_rows)}</td><td>{Object.entries(r.metrics || {}).map(([k, v]) => k + ': ' + v).join('; ')}</td></tr>)}</tbody></table></div></details>}</ReportSection></Reveal></Deferred>
    <Deferred><Reveal><div className="er-two"><ReportSection number="7" title="Operational Insights & Achievements"><div className="er-insight-heading"><TrendingUp /><p>{conclusion.text}</p></div>{conclusion.achievements.map(id => <p key={id}><CheckCircle2 size={16} className="er-positive" />{id}: higher recorded result in an equal-length previous period comparison.</p>)}<p className="er-note">Higher session/approval counts mean more recorded activity, not an achieved compliance target. No composite implementation score.</p></ReportSection><ReportSection number="8" title="Attention Required" subtitle="Recorded exceptions; severity is not inferred.">{exceptions.length ? exceptions.map(e => <div className="er-exception" key={e.label}><AlertTriangle size={16} /><span>{e.label}<small>As of {to} · severity not supplied</small></span><strong>{number(e.count)}</strong>{link(EXECUTIVE_MODULES.find(m => m.id === e.id))}</div>) : <Empty>No positive exception counts are available. Missing sources do not establish an exception-free period.</Empty>}{conclusion.gaps.length > 0 && <p className="er-note">Reporting gaps: {conclusion.gaps.join(', ')}.</p>}</ReportSection></div></Reveal></Deferred>
    <Deferred><Reveal><ReportSection number="9" title="Compliance Overview" subtitle="Valid completion indicators; no combined compliance score."><div className="er-compliance">{['cm', 'pm', 'cleaning'].map(id => <div key={id}><CompletionRing metric={model.modules[id]} title={EXECUTIVE_MODULES.find(m => m.id === id).title} reduced={reduced} /><p>{model.modules[id].reason || 'Unavailable source'}</p>{link(EXECUTIVE_MODULES.find(m => m.id === id))}</div>)}</div></ReportSection></Reveal></Deferred>
    <Deferred><Reveal><ReportBoundary key={requestKey + state + store}><Suspense fallback={<div className="er-skeleton">Loading activity panel...</div>}><ActivityPanel key={requestKey + state + store + refresh} report={data} scope={scope} canOpen={canOpen} /></Suspense></ReportBoundary></Reveal></Deferred>
    <Deferred><Reveal><div className="er-two"><ReportSection number="12" title="Store Coverage & Implementation" subtitle="Authorized Store Master inventory; participation is a separate metric."><MetricFacts counts={{ 'Authorized stores': data ? model.stores.length : null, 'Reporting stores': null, 'Unreported stores': null }} /><div className="er-coverage">{visibleStates.map(r => <div key={r.state}><span>{stateName(r.state)}</span><meter min="0" max={Math.max(model.stores.length, 1)} value={r.stores} aria-label={stateName(r.state) + ' share of authorized inventory'} /><strong>{data ? number(r.stores) : 'N/A'}</strong></div>)}</div><p className="er-note">Participation is not supplied. Missing reports do not prove store inactivity. Store Master controls identity and reporting geography.</p></ReportSection><ReportSection number="13" title="Next Actions" subtitle="Explicit recorded exceptions and source gaps.">{exceptions.length ? <ol className="er-next-actions">{exceptions.map(e => <li key={e.label}><strong>{e.label}: {number(e.count)}</strong><p>Review existing module records. Owner and due date not supplied.</p>{link(EXECUTIVE_MODULES.find(m => m.id === e.id))}</li>)}</ol> : <Empty>Review reporting coverage before assigning operational priorities.</Empty>}{conclusion.gaps.length > 0 && <p className="er-note">Resolve source availability for {conclusion.gaps.join(', ')} before drawing conclusions.</p>}</ReportSection></div></Reveal></Deferred>
    <Deferred><Reveal><ReportSection number="14" title="Report Details"><dl className="er-report-details">{[['Reporting period', period.start + ' to ' + (to || 'Unavailable')], ['Geographic scope', stateName(state) || 'Authorized South Zone'], ['Store scope', store || 'All authorized stores'], ['Report generated', formatTime(data?.updated_at)], ['Last successful refresh', formatTime(loaded?.key === requestKey ? loaded.refreshed : null)], ['Data source', 'Authenticated Retail dashboard; Store Master; bounded Training sample'], ['Coverage limitations', 'No zone aggregates, store participation, period topic/evidence totals or cross-module source observation timestamp.']].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></ReportSection></Reveal></Deferred>
    <Reveal><ReportSection number="15" title="Overall Conclusion" className="er-conclusion"><CheckCircle2 size={32} /><div><p>{conclusion.text}</p><p>{exceptions.length ? `${exceptions.length} positive exception categories require source-record review.` : 'No confirmed exception-free conclusion is available.'} {conclusion.gaps.length ? `Coverage limits: ${conclusion.gaps.join(', ')}.` : 'All six period metrics are available; source coverage still applies.'}</p><small>Auditable rules: positive comparable deltas, recorded exceptions and unavailable metrics. No inferred operational assurance.</small></div></ReportSection></Reveal>
    <footer className="er-footer"><Clock3 size={14} />Private internal management report · myQPMS · {formatTime(data?.updated_at)}</footer>
  </div>;
}
