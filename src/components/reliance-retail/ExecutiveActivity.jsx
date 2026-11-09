import { useEffect, useRef, useState } from 'react';
import { Eye, ChevronLeft, ChevronRight, X, ImageOff } from 'lucide-react';
import { authenticatedApiRequest } from '../../services/api.js';
import { useModalFocus } from '../../hooks/useModalFocus.js';
import { reportingState } from '../../../backend/shared/retailAttendance.js';
import { EXECUTIVE_MODULES, number, scopedActivity } from '../../utils/retailExecutiveReport.js';
import { ReportSection, ModuleLink, Empty } from './ExecutiveReportUi.jsx';

function PhotoPreview({ photo, onClose }) {
  const ref = useModalFocus({ onClose });
  return <div className="er-photo-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label="Authorized evidence preview" tabIndex={-1}><header><h2>{photo.name}</h2><button onClick={onClose} aria-label="Close evidence preview"><X /></button></header><img src={photo.url} alt={photo.name} referrerPolicy="no-referrer" /></section></div>;
}
export default function ExecutiveActivity({ report, scope, canOpen }) {
  const [tab, setTab] = useState('training'), [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(null), [error, setError] = useState('');
  const [photos, setPhotos] = useState([]), [evidenceError, setEvidenceError] = useState(''), [preview, setPreview] = useState(null), [loadingPhoto, setLoadingPhoto] = useState(false);
  const generation = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = JSON.stringify([report?.from, report?.to, scope.state, scope.store]);
  const training = canOpen(EXECUTIVE_MODULES[5].route);
  useEffect(() => {
    let live = true;
    if (!training || !report?.to) return;
    authenticatedApiRequest({ url: '/api/training/sessions', params: { date_from: report.from, date_to: report.to, status: 'submitted', limit: 6, ...(scope.store ? { store_id: scope.store } : {}) } })
      .then(response => { if (live) { setLoaded({ key, rows: scopedActivity(response.data.sessions || [], report, scope) }); setError(''); } })
      .catch(e => { if (live) { setLoaded({ key, rows: [] }); setError(e.response?.data?.message || e.message); } });
    return () => { live = false; };
  }, [key, training, report, scope]);
  const sessions = loaded?.key === key ? loaded.rows : [];
  async function evidence(row) {
    const request = ++generation.current;
    setPhotos([]); setEvidenceError(''); setLoadingPhoto(true);
    try {
      const detail = (await authenticatedApiRequest({ url: `/api/training/sessions/${encodeURIComponent(row.id)}` })).data;
      const items = (detail.evidence || []).filter(e => ['topic_photo', 'group_photo'].includes(e.evidence_type) && ['image/jpeg', 'image/png', 'image/webp'].includes(e.mime_type)).slice(0, 3);
      const result = await Promise.all(items.map(async e => {
        const view = (await authenticatedApiRequest({ url: `/api/training/sessions/${encodeURIComponent(row.id)}/evidence/${encodeURIComponent(e.id)}/view-url` })).data.view;
        if (!view?.url?.startsWith('https://')) throw Error('Authorized photo link unavailable.');
        return { id: e.id, name: e.file_name || 'Recorded Training photo', url: view.url };
      }));
      if (mounted.current && request === generation.current) { setPhotos(result); if (!result.length) setEvidenceError('No supported, classified Training photos are recorded for this session.'); }
    } catch (e) { if (mounted.current && request === generation.current) setEvidenceError(e.response?.data?.message || e.message); }
    finally { if (mounted.current && request === generation.current) setLoadingPhoto(false); }
  }
  const maintenance = ['cm', 'pm'].flatMap(id => (report?.modules?.[id]?.stores || []).filter(s => s.completed && (!scope.state || reportingState(s.state) === scope.state) && (!scope.store || s.id === scope.store)).map(s => ({ ...s, kind: id.toUpperCase() }))).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  const module = EXECUTIVE_MODULES.find(m => m.id === (tab === 'training' ? 'training' : tab === 'cleaning' ? 'cleaning' : 'cm'));
  const rows = tab === 'training' ? sessions : tab === 'maintenance' ? maintenance.slice(page * 6, page * 6 + 6) : [];
  return <div className="er-activity-grid"><ReportSection number="10" title="Recent Operations" subtitle="Bounded read-only activity; never used to estimate period totals." action={tab !== 'fault' && <ModuleLink module={module} allowed={canOpen(module.route)} scope={scope} />}>
    <div className="er-tabs" role="tablist" aria-label="Recent operation modules">{[['cleaning', 'Deep Cleaning'], ['training', 'Training'], ['maintenance', 'CM/PM'], ['fault', 'Fault Tracker']].map(([id, label]) => <button role="tab" aria-selected={tab === id} aria-controls="er-recent-panel" id={'er-tab-' + id} key={id} onClick={() => { setTab(id); setPage(0); }}>{label}</button>)}</div>
    <div id="er-recent-panel" role="tabpanel" aria-labelledby={'er-tab-' + tab}>
      {tab === 'training' && loaded?.key !== key && training && <p role="status">Loading up to six authorized submitted sessions...</p>}
      {tab === 'training' && error && <p role="alert">{error}</p>}
      {rows.length > 0 ? <div className="er-table-scroll"><table><thead><tr><th>Date</th><th>Store</th><th>Class / work</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{rows.map(r => <tr key={r.id + (r.kind || '')}><td>{r.training_date || r.completed_on || 'Not recorded'}</td><td>{r.store?.store_code || r.store_code}<small>{r.store?.store_name || r.store_name}</small></td><td>{r.category?.code === 'technical_mep' ? 'MEPC' : r.category?.code === 'hk' ? 'HK' : r.kind || 'Unclassified'}</td><td><span className="er-status">{r.status || (r.completed ? 'Completed' : 'Not recorded')}</span></td><td>{tab === 'training' ? <button disabled={loadingPhoto || !r.evidence_count} onClick={() => void evidence(r)} aria-label={'View evidence for ' + r.id}><Eye size={14} />{number(r.evidence_count)}</button> : 'Open module'}</td></tr>)}</tbody></table></div> : <Empty>{tab === 'cleaning' ? 'The aggregate dashboard does not provide bounded Cleaning records. Use the authorized Deep Cleaning report for submissions and before/after evidence.' : tab === 'fault' ? 'Live fault records and counts are available in the existing Fault Tracker; no bounded aggregate feed is supplied here.' : 'No matching records in this bounded activity sample. This is not proof of no activity in the full period.'}</Empty>}
      {tab === 'training' && <p className="er-note">Latest six submitted sessions before geographic filtering. Topics and attendees remain available in the Training report; this sample is not reporting coverage.</p>}
      {tab === 'maintenance' && <div className="er-pagination"><button disabled={!page} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} />Previous</button><span>Page {page + 1} · {maintenance.length} records already in report</span><button disabled={(page + 1) * 6 >= maintenance.length} onClick={() => setPage(p => p + 1)}>Next<ChevronRight size={14} /></button></div>}
      {tab === 'fault' && <ModuleLink module={{ route: '/fault-tracker' }} allowed={canOpen('/fault-tracker')} scope={scope}>Open Fault Tracker</ModuleLink>}
    </div>
  </ReportSection><ReportSection number="11" title="Evidence Spotlight" subtitle="Private evidence · authenticated access only">
    {photos.length ? <div className="er-evidence-grid">{photos.map(photo => <button key={photo.id} aria-label={photo.name} onClick={() => setPreview(photo)}><img src={photo.url} alt={photo.name} loading="lazy" referrerPolicy="no-referrer" onError={() => { setPhotos([]); setPreview(null); setEvidenceError('Photo unavailable or link expired. Request evidence again from the record.'); }} /><span>{photo.name}</span></button>)}</div> : <Empty><ImageOff size={26} />{loadingPhoto ? 'Authorizing selected evidence...' : 'Select evidence on a recent Training record to load actual authorized photos.'}</Empty>}
    {evidenceError && <p role="alert">{evidenceError}</p>}<p className="er-note">Signed links expire. Refresh from the source record. Deep Cleaning and Thermography evidence remain in their authorized module viewers.</p>
    {preview && <PhotoPreview photo={preview} onClose={() => setPreview(null)} />}
  </ReportSection></div>;
}
