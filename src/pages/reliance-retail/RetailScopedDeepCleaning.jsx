import DeepCleaningOverview from '../../components/reliance-retail/DeepCleaningOverview.jsx';
import DeepCleaningEvidenceDrawer from '../../components/reliance-retail/DeepCleaningEvidenceDrawer.jsx';
import RetailCleaningMonthlyPlan from '../../components/reliance-retail/RetailCleaningMonthlyPlan.jsx';
import { cleaningView, recordedFoName, recordedFoCode, cleaningPhotoCount, recordedStatus } from '../../utils/deepCleaningView.js';
import { useRetailExcelRows } from '../../utils/useRetailExcelRows.js';
import { excelCleaningRows, isExcelSource } from '../../utils/retailExcelInline.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, CalendarDays, ChevronDown, Paintbrush, Filter, Search, Images, Eye, Table2 } from 'lucide-react';
import { authenticatedApiRequest } from '../../services/api.js';
import { indiaToday } from '../../../backend/shared/retailAttendance.js';
import { REPORTING_STATES } from './ifmsDashboardModel.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ReportNotice, ReportPager } from '../../components/reliance-retail/RetailReportUi.jsx';
import { reportPage } from '../../utils/retailReportView.js';
import RetailCleaningSchedule from '../../components/reliance-retail/RetailCleaningSchedule.jsx';
import { useAuth } from '../../context/auth-context.js';
import { isReadOnlyUser } from '../../utils/demoAccess.js';
import { isPlatformAdmin } from '../../utils/authRoles.js';
import '../../components/reliance-retail/deepCleaningV2.css';
function VerifiedFoLink({
  scheduleId,
  onSaved
}) {
  const [source, setSource] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await authenticatedApiRequest({
        method: 'POST',
        url: `/api/reliance-retail/module-reports/deep-cleaning/${encodeURIComponent(scheduleId)}/link-fo`,
        data: {
          source_id: source
        }
      });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  }
  return <details><summary>Link verified FO completion</summary><form onSubmit={save}><label>Existing FO submission ID<input required aria-label="Existing FO cleaning submission ID" value={source} onChange={e => setSource(e.target.value)} /></label><label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I verified this submitted work against the recorded schedule.</label><p>The server requires exact store/date, verified historical FO ownership and stored before/after evidence. Older submissions are not backfilled.</p>{error && <p role="alert">{error}</p>}<button disabled={busy || !confirmed}>Confirm verified link</button></form></details>;
}
export default function RetailScopedDeepCleaning() {
  usePageTitle('Reliance Retail Deep Cleaning');
  const {
    user
  } = useAuth();
  const [selected, setSelected] = useState(null),
    [evidenceError, setEvidenceError] = useState('');
  const [monthly, setMonthly] = useState(false),
    [monthlyAllowed, setMonthlyAllowed] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const today = indiaToday();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01'),
    [to, setTo] = useState(today),
    [state, setState] = useState(''),
    [store, setStore] = useState(''),
    [status, setStatus] = useState('');
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [workPage, setWorkPage] = useState(0),
    [size, setSize] = useState(25),
    [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [evidence, setEvidence] = useState(null),
    [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceRequest = useRef(0);
  const invalidateEvidence = useCallback(() => {
    evidenceRequest.current++;
  }, []);
  const clearEvidence = useCallback(() => {
    evidenceRequest.current++;
    setEvidence(null);
    setSelected(null);
    setEvidenceError('');
    setEvidenceBusy(false);
  }, []);
  function resetView() {
    setPage(0);
    setWorkPage(0);
    clearEvidence();
  }
  useEffect(() => {
    let live = true;
    invalidateEvidence();
    queueMicrotask(() => {
      if (live) {
        setBusy(true);
        setError('');
        setReport(null);
        setEvidence(null);
        setSelected(null);
        setEvidenceError('');
        setEvidenceBusy(false);
      }
    });
    authenticatedApiRequest({
      url: '/api/reliance-retail/module-reports/deep-cleaning',
      params: {
        from,
        to,
        state,
        store
      }
    }).then(r => {
      if (live) setReport(r.data.report);
    }).catch(e => {
      if (live) setError(e.response?.data?.message || e.message);
    }).finally(() => {
      if (live) setBusy(false);
    });
    return () => {
      live = false;
      invalidateEvidence();
    };
  }, [from, to, state, store, refresh, invalidateEvidence]);
  async function inspect(id, record) {
    const request = ++evidenceRequest.current;
    setSelected(record || view.work.find(row => row.id === id) || {
      id
    });
    setEvidenceError('');
    setEvidence(null);
    setEvidenceBusy(true);
    try {
      const result = await authenticatedApiRequest({
        url: `/api/reliance-retail/module-reports/deep-cleaning/${encodeURIComponent(id)}/evidence`,
        params: {
          from,
          to,
          state,
          store
        }
      });
      if (request === evidenceRequest.current) setEvidence(result.data.uploads);
    } catch (e) {
      if (request === evidenceRequest.current) setEvidenceError(e.response?.data?.message || e.message);
    } finally {
      if (request === evidenceRequest.current) setEvidenceBusy(false);
    }
  }
  const excel = useRetailExcelRows('deep_cleaning', from <= '2026-10-31' && to >= '2026-10-01');
  const historical = excelCleaningRows(excel.rows, {
    from,
    to,
    state,
    store,
    query
  });
  const view = cleaningView(report, historical, {
      status,
      query
    }),
    rows = view.schedules,
    work = view.work,
    totals = report?.totals;
  const reportedCompleted = historical.submissions.length;
  const activeFilters = Number(from !== today.slice(0, 7) + '-01' || to !== today) + [state, store, status, query.trim()].filter(Boolean).length;
  function resetFilters() {
    resetView();
    setFrom(today.slice(0, 7) + '-01');
    setTo(today);
    setState('');
    setStore('');
    setStatus('');
    setQuery('');
  }
  async function schedulingAccess() {
    try {
      const result = await authenticatedApiRequest({
        url: '/api/reliance-retail/mis/access'
      });
      const access = result.data.result;
      setMonthlyAllowed(!isReadOnlyUser(user) && access?.active === true && !access.read_only && ['CENTRAL_MIS', 'MIS_HK'].includes(access.role) && access.modules?.includes('cleaning'));
    } catch {
      setMonthlyAllowed(false);
    }
  }
  async function exportReport() {
    setExporting(true);
    setError('');
    try {
      const {
          default: ExcelJS
        } = await import('exceljs'),
        {
          downloadUnified
        } = await import('../../utils/retailUnifiedExport.js'),
        book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Filtered schedules');
      sheet.addRow(['Store Code', 'Store Name', 'Geographic State', 'Reporting State', 'Scheduled Date', 'Status', 'Not Completed Reason', 'Overdue', 'Completion Submission IDs', 'Source', 'FO evidence verified']);
      rows.forEach(row => sheet.addRow([row.store.store_code, row.store.store_name, row.store.state, row.reporting_state, row.scheduled_date, row.display_status, row.not_done_reason, Boolean(row.overdue), (row.submission_ids || []).join(', '), isExcelSource(row) ? 'October Excel (reported)' : 'Operational', isExcelSource(row) ? 'No' : 'See recorded submissions']));
      const submitted = book.addWorksheet('Recorded work');
      submitted.addRow(['Store Code', 'Date', 'Recorded Status', 'Before Images', 'After Images', 'Source', 'Verified FO submission']);
      work.forEach(row => submitted.addRow([row.store.store_code, row.deep_cleaning_date || 'Not recorded in source', row.status, row.before_count ?? '', row.after_count ?? '', isExcelSource(row) ? 'October Excel (reported)' : 'Operational', isExcelSource(row) ? 'No' : 'Yes']));
      await downloadUnified(book, 'Retail_Deep_Cleaning.xlsx');
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }
  return <section className={'retail-report dc-v2 dc-layout' + (selected ? ' dc-with-drawer' : '')}>
 <div className="dc-main"><header className="dc-page-header"><div><p className="dc-eyebrow">RELIANCE RETAIL / OPERATIONS</p><div className="dc-title"><Paintbrush size={37} /><div><h1>Deep Cleaning</h1><p>Plan, assign and track store deep cleaning with photo evidence.</p></div></div></div><div className="dc-actions"><details className="dc-schedule-menu" onToggle={e => {
            if (e.currentTarget.open) void schedulingAccess();
          }}><summary><CalendarDays size={15} />Schedule Deep Cleaning<ChevronDown size={14} /></summary><div><button disabled={isReadOnlyUser(user)} onClick={e => {
                e.currentTarget.closest('details').open = false;
                setScheduling(true);
              }}>Schedule a visit</button>{monthlyAllowed && <button onClick={e => {
                e.currentTarget.closest('details').open = false;
                setMonthly(true);
              }}>Monthly Excel schedule import</button>}</div></details><button disabled={busy} onClick={() => {
            resetView();
            setRefresh(value => value + 1);
          }}><RefreshCw size={14} />Refresh</button><button disabled={!report || busy || exporting} onClick={() => void exportReport()}><Download size={14} />{exporting ? 'Exporting?' : 'Export Report'}</button></div></header>
 {scheduling && <RetailCleaningSchedule readOnly={isReadOnlyUser(user)} onClose={() => setScheduling(false)} onSaved={result => {
        resetView();
        const day = result.schedule?.scheduled_date;
        if (day && day > to) setTo(day);
        setRefresh(v => v + 1);
      }} />}
 {monthly && monthlyAllowed && <section className="dc-card dc-monthly" aria-label="Monthly schedule import"><header className="dc-card-heading"><h2>Monthly schedule import</h2><button onClick={() => {
            setMonthly(false);
            resetView();
            setRefresh(v => v + 1);
          }}>Close import</button></header><RetailCleaningMonthlyPlan /></section>}
 {busy && <ReportNotice>Loading cleaning tracker?</ReportNotice>}{error && <ReportNotice error>{error}</ReportNotice>}
 <DeepCleaningOverview view={view} available={Boolean(report && totals && !busy)} />
 <section className="dc-card dc-filter-card" aria-label="Cleaning filters"><div className="dc-card-heading"><h2><Filter size={16} />Filters <span className="dc-filter-count">{activeFilters} Active</span></h2><button onClick={resetFilters}><RefreshCw size={12} />Reset</button></div><div className="dc-filter-grid"><label className="dc-date-label">Date Range<span className="dc-date-range"><input aria-label="Cleaning from" type="date" value={from} max={to} onChange={e => {
                if (e.target.value) {
                  resetView();
                  setFrom(e.target.value);
                }
              }} /><span>-</span><input aria-label="Cleaning to" type="date" value={to} min={from} onChange={e => {
                if (e.target.value) {
                  resetView();
                  setTo(e.target.value);
                }
              }} /></span></label><label>State<select aria-label="Cleaning state" value={state} onChange={e => {
              resetView();
              setState(e.target.value);
              setStore('');
            }}><option value="">All authorized states</option>{REPORTING_STATES.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label>Store<select aria-label="Cleaning store" value={store} onChange={e => {
              resetView();
              setStore(e.target.value);
            }}><option value="">All stores</option>{report?.stores?.map(item => <option key={item.id} value={item.id}>{item.store_code} - {item.store_name}</option>)}</select></label><label>Status<select aria-label="Cleaning status" value={status} onChange={e => {
              resetView();
              setStatus(e.target.value);
            }}><option value="">All statuses</option>{view.statuses.map(value => <option key={value}>{value}</option>)}</select></label><label>Search<span className="dc-search"><Search size={14} /><input aria-label="Search cleaning records" type="search" placeholder="Store code / name / FO name" value={query} onChange={e => {
                resetView();
                setQuery(e.target.value);
              }} /></span></label></div></section>
 {report && !busy && <>
 {!totals && <ReportNotice>Schedule storage is unavailable. Completion submissions remain visible; scheduled totals are unavailable.</ReportNotice>}{!!report.exceptions?.length && <ReportNotice>{report.exceptions.length} records excluded because canonical store identity is unresolved.</ReportNotice>}
 <section className="dc-card dc-work"><div className="dc-card-heading"><h2><Table2 size={18} />Store-wise Submitted Work</h2><span>{work.length.toLocaleString('en-IN')} submissions</span><button disabled={!work.length} onClick={() => {
              setSize(100);
              setWorkPage(0);
            }}>Show 100</button></div><div className="dc-table-scroll" role="region" aria-label="Submitted cleaning work" tabIndex={0}><table><thead><tr>{['Store Code', 'Store Name', 'State', 'FO Name', 'Scheduled Date', 'Visit Date', 'Status', 'Evidence', 'Actions'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(work, workPage, size).map(row => <tr key={row.id} className={selected?.id === row.id ? 'dc-selected' : ''}><td><strong>{row.store.store_code}</strong></td><td>{row.store.store_name}</td><td>{row.store.state}</td><td>{recordedFoName(row) || recordedFoCode(row) || 'Not recorded'}</td><td>{row.scheduled_date || 'Not recorded'}</td><td>{row.deep_cleaning_date || 'Not recorded'}</td><td><span className="dc-status" data-status={recordedStatus(row)}>{recordedStatus(row)}</span>{isExcelSource(row) && <small>Excel reported - unverified</small>}</td><td><span className="dc-evidence-count"><Images size={13} />{isExcelSource(row) ? 'Not supplied' : cleaningPhotoCount(row) == null ? 'Not recorded' : cleaningPhotoCount(row) + ' photos'}</span></td><td>{isExcelSource(row) ? <small>No FO evidence</small> : <button aria-label={'View evidence for ' + row.store.store_code} onClick={() => void inspect(row.id, row)}><Eye size={12} />View</button>}</td></tr>)}</tbody></table></div>{!work.length && <p className="dc-empty">No authorized submissions match these filters.</p>}<ReportPager label="Cleaning work" count={work.length} page={workPage} size={size} onPage={setWorkPage} onSize={setSize} /></section>
 <details className="dc-report-notes"><summary>Reporting definitions and source history</summary><p>Operational KPIs require exact linked FO completion; cancelled schedules and Excel-reported rows are excluded. Pending and overdue do not mean recorded failure. Filtered charts and KPIs use the same authorized schedule set.</p><p>Month-on-month comparison and additional audit events are unavailable unless supplied by the existing API. Missing FO details and timestamps are never inferred.</p>{historical.schedules.length > 0 && <p>October Excel: {historical.schedules.length} source schedules; {reportedCompleted} source-reported completions, without FO-verified evidence.</p>}{excel.loading && <ReportNotice>Loading October Excel history?</ReportNotice>}{excel.error && <ReportNotice error>October Excel records could not be loaded: {excel.error}</ReportNotice>}</details>
   {isPlatformAdmin(user) && <details className="retail-report-panel retail-schedule-admin">
    <summary className="retail-report-panel-heading">Advanced · Schedule administration and verified FO linking</summary>
    <div className="retail-report-panel"><div className="retail-report-panel-heading"><h2>Store-wise cleaning schedules</h2><span>{rows.length} matching schedules</span></div>
    <div className="retail-report-table" role="region" aria-label="Cleaning schedules" tabIndex={0}><table><thead><tr>{['Store Code / Name', 'State', 'Scheduled date', 'Status', 'Reason / Evidence'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(rows, page, size).map(row => <tr key={row.id}>
     <td>{row.store.id ? <button className="retail-report-link" onClick={() => {
                        resetView();
                        setStore(row.store.id);
                      }}>{row.store.store_code}</button> : <strong>{row.store.store_code}</strong>}<p>{row.store.store_name || 'Store name unavailable'}</p>{isExcelSource(row) && <small>Excel reported · {row.match_status === 'MATCHED' ? 'Store matched' : 'Store identity unresolved'}</small>}</td><td>{REPORTING_STATES.find(item => item.code === row.reporting_state)?.label || row.reporting_state}</td><td>{row.scheduled_date}</td>
     <td><span className="retail-report-status" data-status={row.display_status}>{row.display_status}</span>{isExcelSource(row) && <p className="retail-report-description">Excel reported · not FO verified</p>}{row.overdue && <span className="retail-report-overdue">Overdue · completion not recorded</span>}</td>
     <td>{row.not_done_reason || '—'}{(row.submission_ids || []).map(id => <p key={id}><button className="retail-report-link" disabled={evidenceBusy} onClick={() => void inspect(id)}>Before / after evidence</button></p>)}{!isExcelSource(row) && isPlatformAdmin(user) && !isReadOnlyUser(user) && row.display_status === 'Scheduled' && <VerifiedFoLink scheduleId={row.id} onSaved={() => {
                        resetView();
                        setRefresh(v => v + 1);
                      }} />}</td>
    </tr>)}</tbody></table></div>{!rows.length && <p className="retail-report-empty">No matching recorded schedules.</p>}
    <ReportPager label="Cleaning schedules" count={rows.length} page={page} size={size} onPage={setPage} onSize={setSize} />
   </div>
   </details>}
 </>}
 </div>{selected && <DeepCleaningEvidenceDrawer key={selected.id} record={selected} uploads={evidence} busy={evidenceBusy} error={evidenceError} onClose={clearEvidence} onRetry={() => void inspect(selected.id, selected)} />}</section>;
}
