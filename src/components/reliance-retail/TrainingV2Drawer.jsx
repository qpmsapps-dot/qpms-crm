import { useTrainingDrawerModal } from './useTrainingDrawerModal.js';
import { trainingTopics } from '../../utils/trainingView.js';
import { useEffect, useRef, useState, createElement } from 'react';
import { GraduationCap, X, Store, UserRound, CalendarDays, MapPin, ClipboardList, UsersRound, Images, FileText, Eye, Download, ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus.js';
const time = v => {
  if (!v) return 'Not recorded';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata'
  }).format(d) + ' IST';
};
const photoTypes = new Set(['topic_photo', 'group_photo', 'attendee_photo', 'attendance_photo']);
function Photo({
  item,
  url,
  onOpen,
  onRefresh
}) {
  const [failed, setFailed] = useState(false);
  return <div className="tv-photo"><button aria-label={'Preview ' + item.file_name} onClick={onOpen} disabled={!url || failed}>{url && !failed ? <img src={url} alt={item.file_name} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{failed ? 'Image unavailable or expired' : 'Photo authorization pending'}</span>}<Expand size={14} /></button>{failed && <button onClick={() => {
      setFailed(false);
      onRefresh();
    }}>Refresh link</button>}</div>;
}
function Preview({
  photos,
  index,
  setIndex,
  links,
  onClose
}) {
  const ref = useModalFocus({
    onClose
  });
  const item = photos[index];
  return <div className="dc-preview-backdrop"><section className="dc-preview" role="dialog" aria-modal="true" aria-label="Training photo preview" tabIndex={-1} ref={ref} onKeyDown={e => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((index + 1) % photos.length);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((index + photos.length - 1) % photos.length);
      }
    }}><header><strong>{item.file_name}</strong><button onClick={onClose} aria-label="Close photo preview"><X /></button></header><img key={item.id} src={links[item.id]} alt={item.file_name} referrerPolicy="no-referrer" /><footer className="tv-preview-controls"><button disabled={photos.length < 2} aria-label="Previous photo" onClick={() => setIndex((index + photos.length - 1) % photos.length)}><ChevronLeft /></button><span>{index + 1} / {photos.length}</span><button disabled={photos.length < 2} aria-label="Next photo" onClick={() => setIndex((index + 1) % photos.length)}><ChevronRight /></button></footer></section></div>;
}
export default function TrainingV2Drawer({
  record,
  detail,
  busy,
  error,
  links,
  linkErrors,
  onAuthorize,
  onRetry,
  onClose
}) {
  const { ref: drawerRef, modal } = useTrainingDrawerModal();
  const initialOpener = useRef(document.activeElement);
  const [tab, setTab] = useState('training'),
    [preview, setPreview] = useState(null),
    [downloadError, setDownloadError] = useState('');
  const close = useRef(null),
    abort = useRef(null);
  useEffect(() => {
    const opener = initialOpener.current;
    close.current?.focus();
    const escape = e => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      abort.current?.abort();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [onClose]);
  const session = detail?.session || record,
    evidence = detail?.evidence || [];
  const photos = evidence.filter(e => photoTypes.has(e.evidence_type) && ['image/jpeg', 'image/png', 'image/webp'].includes(e.mime_type));
  const attendee = photos.filter(e => ['attendee_photo', 'attendance_photo'].includes(e.evidence_type));
  const training = photos.filter(e => !attendee.includes(e));
  const selected = tab === 'attendees' ? attendee : training;
  const docs = evidence.filter(e => ['training_document', 'attendance_sheet', 'document', 'checklist'].includes(e.evidence_type) && ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(e.mime_type));
  const available = selected.filter(e => links[e.id]);
  const topicInfo = trainingTopics(record, detail);
  const facts = [[UserRound, 'Trainer', session.trainer_name_snapshot || record.trainer_name || 'Not recorded', session.trainer_employee_code || record.trainer_employee_code], [ClipboardList, 'Topics', (topicInfo.selected == null ? 'Unknown selected' : topicInfo.selected + ' selected') + ' / ' + (topicInfo.covered == null ? 'Unknown covered' : topicInfo.covered + ' covered')], [CalendarDays, 'Training Date', session.training_date || 'Not recorded', session.training_at ? time(session.training_at) : 'Time not recorded'], [UsersRound, 'Recorded Attendees', Array.isArray(detail?.attendees) ? detail.attendees.length + ' Members' : record.attendee_count ?? 'Not recorded'], [GraduationCap, 'Class', record.training_class], [Images, 'Evidence', detail ? evidence.length + ' Files' : 'Not loaded'], [MapPin, 'Store Address', record.store?.address || detail?.store?.address || 'Not recorded'], [FileText, 'Supporting Doc', detail ? docs.length + ' Files' : 'Not loaded']];
  async function download(item) {
    try {
      setDownloadError('');
      abort.current?.abort();
      abort.current = new AbortController();
      const response = await fetch(links[item.id], {
        referrerPolicy: 'no-referrer',
        signal: abort.current.signal
      });
      if (!response.ok) throw Error('Authorized link expired. Refresh the document link.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = item.file_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (e.name !== 'AbortError') setDownloadError(e.message);
    }
  }
  return <>{modal && <div className="tv-drawer-backdrop" aria-hidden="true" />}<aside ref={drawerRef} tabIndex={-1} role={modal ? 'dialog' : undefined} aria-modal={modal ? true : undefined} className="dc-drawer dc-card tv-drawer" aria-label="Training Details"><header className="dc-drawer-header"><h2><GraduationCap size={21} />Training Details</h2><button ref={close} aria-label="Close Training details" onClick={onClose}><X size={18} /></button></header><div className="dc-drawer-scroll"><section className="dc-store-info"><span className="dc-store-icon"><Store size={23} /></span><div><h3>{record.store?.store_code} / {record.store?.store_name || 'Store name not recorded'}</h3><small>Reliance Retail | {record.state || record.store?.state}</small></div><span className="dc-status" data-status={session.status}>{session.status || 'Not recorded'}</span></section><section className="dc-facts">{facts.map(([Icon, title, value, note]) => <div key={title}>{createElement(Icon, {
            size: 16
          })}<div><span>{title}</span><strong>{title === 'Class' ? <span className={'tv-class tv-' + record.training_class}>{value} Training</span> : value}</strong>{note && <small>{note}</small>}</div></div>)}</section>{busy && <p role="status" className="dc-empty">Loading authorized Training details?</p>}{error && <div role="alert" className="dc-empty">{error}<button onClick={onRetry}>Retry Training details</button></div>}{detail && !busy && !error && <><section className="dc-drawer-section"><div className="dc-card-heading"><h3>Photo Evidence</h3><div className="dc-photo-tabs" role="group" aria-label="Training photo type"><button aria-pressed={tab === 'training'} onClick={() => setTab('training')}>Training ({training.length})</button>{attendee.length > 0 && <button aria-pressed={tab === 'attendees'} onClick={() => setTab('attendees')}>Attendees ({attendee.length})</button>}</div></div><div className="dc-photo-grid">{selected.map(item => <div key={item.id}><Photo item={item} url={links[item.id]} onOpen={() => setPreview(available.findIndex(e => e.id === item.id))} onRefresh={() => onAuthorize(item)} />{!links[item.id] && <button onClick={() => onAuthorize(item)}>{linkErrors[item.id] ? 'Retry authorization' : 'Load photo'}</button>}{linkErrors[item.id] && <small role="alert">{linkErrors[item.id]}</small>}</div>)}{!selected.length && <p className="dc-muted">No classified training photos recorded.</p>}</div></section><section className="dc-drawer-section"><h3>Supporting Document</h3>{!docs.length && <p className="dc-muted">No supported document recorded.</p>}{docs.map(item => <div key={item.id} className="dc-document"><FileText size={23} /><div><strong>{item.file_name}</strong><small>{item.mime_type}{Number.isFinite(item.file_size) ? ' / ' + (item.file_size / 1024).toFixed(0) + ' KB' : ''}</small>{linkErrors[item.id] && <small role="alert">{linkErrors[item.id]}</small>}</div>{links[item.id] ? <><a className="dc-icon-button" href={links[item.id]} target="_blank" rel="noreferrer" aria-label={'Preview ' + item.file_name}><Eye size={16} /></a><button aria-label={'Download ' + item.file_name} onClick={() => void download(item)}><Download size={16} /></button><button aria-label={'Refresh link for ' + item.file_name} onClick={() => onAuthorize(item)}>Refresh</button></> : <button onClick={() => onAuthorize(item)}>Get evidence link</button>}</div>)}{downloadError && <p role="alert">{downloadError}</p>}</section><section className="dc-drawer-section dc-audit"><h3>Audit Trail</h3>{[{
            at: session.created_at,
            name: 'Record Created',
            actor: session.created_by_name || session.created_by
          }, {
            at: session.submitted_at,
            name: 'Training Submitted',
            actor: session.submitted_by_name || session.submitted_by
          }, ...(detail.events || []).map(e => ({
            at: e.created_at,
            name: e.event_type,
            actor: e.actor_name || e.actor_profile_id
          }))].filter(e => e.at).map((e, i) => <article key={i}><span className="dc-audit-dot" /><strong>{e.name}</strong><small>{e.actor || 'Actor not recorded'}</small><time dateTime={e.at}>{time(e.at)}</time></article>)}</section><details className="tv-record-extra"><summary>Topics, attendees and historical ownership</summary><p>{record.ownership?.known ? 'Historical Zone: ' + (record.ownership.zone_id || 'Unassigned') + ' ? FO: ' + (record.ownership.fo_profile_id || 'Unassigned') : 'Historical ownership unavailable'}</p>{(detail.topics || []).map(t => <p key={t.id}>{t.topic?.module_name || t.topic?.name || 'Topic'} / {t.is_covered ? 'Covered' : 'Pending'}</p>)}{(detail.attendees || []).map(a => <p key={a.id}>{a.employee_name} / {a.employee_code}</p>)}</details></>}</div><footer className="dc-drawer-footer"><span>Read-only authorized evidence</span><button disabled={busy} onClick={onRetry}>Refresh details</button></footer>{preview != null && available[preview] && <Preview photos={available} index={preview} setIndex={setPreview} links={links} onClose={() => setPreview(null)} />}</aside></>;
}
