import { useLocation } from 'react-router-dom';
import { readRetailNavigation } from '../../utils/retailNavigation.js';
import { useRetailExcelRows } from '../../utils/useRetailExcelRows.js';
import { excelTrainingRows, isExcelSource } from '../../utils/retailExcelInline.js';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Download, RefreshCw, GraduationCap, Filter, Search, Table2, CheckCircle2, TriangleAlert, Minus } from 'lucide-react';
import RetailStateCoverage from '../../components/reliance-retail/RetailStateCoverage.jsx';
import { reportingState, indiaToday } from '../../../backend/shared/retailAttendance.js';
import { REPORTING_STATES } from './ifmsDashboardModel.js';
import { downloadUnified } from '../../utils/retailUnifiedExport.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { authenticatedApiRequest } from '../../services/api.js';
import { retailUnifiedApi } from '../../services/retailUnifiedApi.js';
import { trainingReport } from '../../../backend/shared/retailTrainingReport.js';
import { ReportNotice, ReportPager } from '../../components/reliance-retail/RetailReportUi.jsx';
import { reportPage } from '../../utils/retailReportView.js';
import { useAuth } from '../../context/auth-context.js';
import { isPlatformAdmin } from '../../utils/authRoles.js';
import TrainingV2Overview from '../../components/reliance-retail/TrainingV2Overview.jsx';
import TrainingV2Drawer from '../../components/reliance-retail/TrainingV2Drawer.jsx';
import { trainingOverview, trainingEvidenceState, trainingExportRows, filterTrainingRows } from '../../utils/trainingView.js';
import '../../components/reliance-retail/deepCleaningV2.css';
import '../../components/reliance-retail/trainingV2.css';
export default function RetailTraining() {
  const {
    user
  } = useAuth();
  usePageTitle('Reliance Retail HK & MEPC Training');
  const location = useLocation();
  const [entryScope] = useState(() => readRetailNavigation(location.state, 'training', indiaToday()));
  const [sessions, setSessions] = useState([]),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(''),
    [ownershipError, setOwnershipError] = useState(''),
    [busy, setBusy] = useState(true),
    [detail, setDetail] = useState(null),
    [evidenceLinks, setEvidenceLinks] = useState({});
  const [from, setFrom] = useState(entryScope?.from || indiaToday().slice(0, 7) + '-01'),
    [to, setTo] = useState(entryScope?.to || indiaToday()),
    [filter, setFilter] = useState(() => entryScope ? { state: entryScope.state, store: entryScope.store, zone: entryScope.zone } : {}),
    [query, setQuery] = useState('');
  const [page, setPage] = useState(0),
    [size, setSize] = useState(25),
    [refresh, setRefresh] = useState(0),
    [detailBusy, setDetailBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState(null),
    [detailError, setDetailError] = useState(''),
    [linkErrors, setLinkErrors] = useState({});
  const inspection = useRef(0);
  const invalidateInspection = useCallback(() => {
    inspection.current++;
  }, []);
  const closeDetail = useCallback(() => {
    inspection.current++;
    setSelected(null);
    setDetail(null);
    setDetailError('');
    setEvidenceLinks({});
    setLinkErrors({});
    setDetailBusy(false);
  }, []);
  function resetView() {
    setPage(0);
    closeDetail();
  }
  useEffect(() => {
    let live = true;
    invalidateInspection();
    queueMicrotask(() => {
      if (live) {
        setBusy(true);
        setError('');
        setOwnershipError('');
        setSessions([]);
        setSnapshot(null);
        setSelected(null);
        setDetail(null);
        setDetailError('');
        setEvidenceLinks({});
        setLinkErrors({});
        setDetailBusy(false);
      }
    });
    Promise.allSettled([authenticatedApiRequest({
      url: '/api/reliance-retail/module-reports/training',
      params: {
        from,
        to
      }
    }).then(response => { if (!Array.isArray(response.data?.report?.rows)) throw Error('Training report is incomplete.'); return response; }), retailUnifiedApi.snapshot({
      from,
      to
    })]).then(([training, master]) => {
      if (!live) return;
      if (training.status === 'fulfilled') setSessions(training.value.data?.report?.rows || []);else setError(training.reason.response?.data?.message || training.reason.message);
      if (master.status === 'fulfilled') setSnapshot(master.value);else setOwnershipError('Zone/FO ownership unavailable in your authorized scope. Training records remain available.');
      setBusy(false);
    });
    return () => {
      live = false;
      invalidateInspection();
    };
  }, [from, to, refresh, invalidateInspection]);
  const canonicalRows = useMemo(() => trainingReport(sessions, snapshot), [sessions, snapshot]);
  const liveRows = useMemo(() => filterTrainingRows(canonicalRows, filter, query), [canonicalRows, filter, query]);
  const hkExcel = useRetailExcelRows('soft_skill_training', from <= '2026-10-31' && to >= '2026-10-01');
  const mepcExcel = useRetailExcelRows('technical_training', from <= '2026-10-31' && to >= '2026-10-01');
  const excelFilter = {
    from,
    to,
    state: filter.state || '',
    store: filter.store || '',
    query
  };
  const reportedRows = !filter.zone && !filter.fo ? [...excelTrainingRows(hkExcel.rows, 'HK', excelFilter), ...excelTrainingRows(mepcExcel.rows, 'MEPC', excelFilter)].filter(row => !filter.class || row.training_class === filter.class) : [];
  const rows = [...liveRows, ...reportedRows];
  const change = (key, value) => {
    resetView();
    setFilter(previous => ({
      ...previous,
      [key]: value
    }));
  };
  async function inspect(id, row) {
    const request = ++inspection.current;
    setSelected(row || rows.find(r => r.id === id));
    setDetailError('');
    setDetail(null);
    setEvidenceLinks({});
    setLinkErrors({});
    setDetailBusy(true);
    try {
      const response = await authenticatedApiRequest({
        url: `/api/training/sessions/${encodeURIComponent(id)}`
      });
      if (request === inspection.current) setDetail(response.data);
    } catch (e) {
      if (request === inspection.current) setDetailError(e.response?.data?.message || e.message);
    } finally {
      if (request === inspection.current) setDetailBusy(false);
    }
  }
  async function viewEvidence(evidence) {
    const request = inspection.current;
    try {
      setLinkErrors(previous => ({
        ...previous,
        [evidence.id]: ''
      }));
      const response = await authenticatedApiRequest({
          url: `/api/training/sessions/${encodeURIComponent(detail.session.id)}/evidence/${encodeURIComponent(evidence.id)}/view-url`
        }),
        url = response.data?.view?.url;
      if (!url || !url.startsWith('https://')) throw Error('Evidence link unavailable.');
      if (request === inspection.current) setEvidenceLinks(previous => ({
        ...previous,
        [evidence.id]: url
      }));
    } catch (e) {
      if (request === inspection.current) {
        setEvidenceLinks(previous => {
          const next = {
            ...previous
          };
          delete next[evidence.id];
          return next;
        });
        setLinkErrors(previous => ({
          ...previous,
          [evidence.id]: e.response?.data?.message || e.message
        }));
      }
    }
  }
  async function exportReport() {
    setExporting(true);
    setError('');
    try {
      const {
          default: ExcelJS
        } = await import('exceljs'),
        book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Training');
      sheet.addRow(['Date', 'Class', 'Source Store Code', 'Geographic State', 'Reporting State', 'Identity Status', 'Trainer / Employee', 'Status', 'Participants', 'Evidence Count', 'Historical Zone ID', 'Historical FO ID', 'Source', 'FO evidence verified']);
      trainingExportRows(rows).forEach(row => {
        row[4] = reportingState(row[3]);
        sheet.addRow(row);
      });
      await downloadUnified(book, 'Retail_Training_Review.xlsx');
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }
  const select = (label, key, options) => <label key={key}>{label}<select aria-label={`Training ${label}`} value={filter[key] || ''} onChange={e => change(key, e.target.value)}><option value="">All</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  // October Excel rows are a reported source snapshot, not FO evidence.
  // Keep reported rows in details; only verified operational sessions enter KPIs.
  const overview = useMemo(() => trainingOverview(liveRows), [liveRows]),
    available = !busy && !error && (!(filter.store || filter.zone || filter.fo) || Boolean(snapshot));
  const today = indiaToday(),
    active = Object.values(filter).filter(Boolean).length + Number(Boolean(query.trim())) + Number(from !== today.slice(0, 7) + '-01' || to !== today);
  function resetFilters() {
    resetView();
    setFilter({});
    setQuery('');
    setFrom(today.slice(0, 7) + '-01');
    setTo(today);
  }
  return <section className={'retail-report dc-v2 tv-v2 dc-layout' + (selected ? ' dc-with-drawer' : '')}><div className="dc-main"><header className="dc-page-header"><div><p className="dc-eyebrow">RELIANCE RETAIL / OPERATIONS</p><div className="dc-title"><GraduationCap size={38} /><div><h1>HK &amp; MEPC Training</h1><p>Monitor training sessions, attendance, topics and evidence across stores.</p></div></div></div><div className="dc-actions"><button disabled={busy} onClick={() => {
            resetView();
            setRefresh(v => v + 1);
          }}><RefreshCw size={14} />Refresh</button><button disabled={busy || !sessions.length || exporting} onClick={() => void exportReport()}><Download size={14} />{exporting ? 'Exporting...' : 'Export Training review'}</button></div></header>
 <TrainingV2Overview data={overview} available={available} />
 <section className="dc-card dc-filter-card"><div className="dc-card-heading"><h2><Filter size={17} />Filters <span className="dc-filter-count">{active} Active</span></h2><button onClick={resetFilters}><RefreshCw size={12} />Reset</button></div><div className="tv-filters"><label>From<input aria-label="Training from" type="date" value={from} max={to} onChange={e => {
              if (e.target.value) {
                resetView();
                setFrom(e.target.value);
              }
            }} /></label><label>To<input aria-label="Training to" type="date" value={to} min={from} onChange={e => {
              if (e.target.value) {
                resetView();
                setTo(e.target.value);
              }
            }} /></label>{select('Class', 'class', [['HK', 'HK'], ['MEPC', 'MEPC']])}{select('State', 'state', REPORTING_STATES.map(item => [item.code, item.label]))}{select('Zone', 'zone', (snapshot?.zones || []).map(item => [item.id, item.zone_name]))}{select('FO', 'fo', (snapshot?.fos || []).map(item => [item.id, item.full_name || item.employee_code]))}{select('Store', 'store', (snapshot?.stores || []).map(item => [item.id, item.store_code + ' / ' + item.store_name]))}<label>Search<span className="dc-search"><Search size={13} /><input aria-label="Search Training records" type="search" value={query} placeholder="Store code, name or trainer" onChange={e => {
                resetView();
                setQuery(e.target.value);
              }} /></span></label></div></section>
 {busy && <ReportNotice>Loading Training records?</ReportNotice>}{error && <ReportNotice error>{error}<button disabled={busy} onClick={() => {
          resetView();
          setRefresh(v => v + 1);
        }}>Retry Training records</button></ReportNotice>}{ownershipError && <ReportNotice>{ownershipError}</ReportNotice>}
 <section className="dc-card dc-work"><div className="dc-card-heading"><h2><Table2 size={17} />Training records</h2><span>{rows.length} records</span><button disabled={!rows.length} onClick={() => {
            setSize(100);
            setPage(0);
          }}>Show 100</button></div><div className="dc-table-scroll" role="region" aria-label="Completed training records" tabIndex={0}><table><thead><tr>{['Date', 'Class', 'Store Code', 'Store Name', 'State', 'Trainer', 'Topics', 'Attendees', 'Evidence', 'Actions'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(rows, page, size).map(row => {
                const ev = trainingEvidenceState(row);
                return <tr key={row.id} className={selected?.id === row.id ? 'dc-selected' : ''}><td>{row.training_date}</td><td><span className={'tv-class tv-' + row.training_class}>{row.training_class}</span></td><td><strong>{row.store?.store_code || 'Not recorded'}</strong></td><td>{row.store?.store_name || 'Not recorded'}</td><td>{row.store?.state || row.state || 'Not recorded'}</td><td>{isExcelSource(row) ? <>{row.source_data?.employee_name || 'Name not recorded'}<small>Excel employee / not verified trainer</small></> : row.trainer_name || 'Not recorded'}</td><td>{row.topic_count == null ? row.topics_text || 'Unknown' : row.topic_count + ' Topics'}</td><td>{row.attendee_count ?? 'Not recorded'}</td><td><span className={'tv-evidence tv-' + ev.replaceAll(' ', '-')} title={ev}>{ev === 'Available' ? <CheckCircle2 size={15} /> : ev === 'Missing required' ? <TriangleAlert size={15} /> : <Minus size={15} />}<span className="tv-sr">{ev}</span></span></td><td>{isExcelSource(row) ? <details><summary>Excel source details</summary><p>Row {row.id.replace('ifms-excel-', '')} / {row.match_status}</p></details> : <button aria-label={'View Training evidence for ' + (row.store?.store_code || row.id)} onClick={() => void inspect(row.id, row)}>View</button>}</td></tr>;
              })}</tbody></table></div>{available && !hkExcel.loading && !mepcExcel.loading && !rows.length && <p className="dc-empty">No authorized Training records match these filters.</p>}<ReportPager label="Training records" count={rows.length} page={page} size={size} onPage={setPage} onSize={setSize} /></section>
 <details className="tv-record-extra"><summary>Source history, coverage and ownership</summary><p>KPIs and chart show {overview.total} verified operational sessions. {reportedRows.length} Excel-reported entries remain separate in the register; employee names are not assumed to be trainers, and evidence is not fabricated. Optional attendees may be entered later; unknown attendance is not zero attendance.</p>{(hkExcel.loading || mepcExcel.loading) && <ReportNotice>Loading historical Excel training?</ReportNotice>}{(hkExcel.error || mepcExcel.error) && <ReportNotice error>October Excel training unavailable: {hkExcel.error || mepcExcel.error}</ReportNotice>}{isPlatformAdmin(user) && snapshot && <RetailStateCoverage snapshot={snapshot} />}<p>Export includes every matching record and historical Zone/FO attribution. Unsupported scheduling and approval actions are not exposed.</p></details></div>
 {selected && <TrainingV2Drawer key={selected.id} record={selected} detail={detail} busy={detailBusy} error={detailError} links={evidenceLinks} linkErrors={linkErrors} onAuthorize={item => void viewEvidence(item)} onRetry={() => void inspect(selected.id, selected)} onClose={closeDetail} />}</section>;
}
