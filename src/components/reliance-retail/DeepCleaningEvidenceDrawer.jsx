import { createElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { X, ClipboardList, Store, UserRound, CalendarDays, MapPin, Images, FileText, Download, Eye, Expand, Paintbrush, History } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus.js';
import { recordedFoName, recordedFoCode, recordedStatus } from '../../utils/deepCleaningView.js';
const stamp = value => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata'
  }).format(date) + ' IST';
};
const safeUrl = url => typeof url === 'string' && url.startsWith('https://');
function Photo({
  item,
  onPreview
}) {
  const [state, setState] = useState('loading');
  return <button className="dc-photo" aria-label={'Preview ' + item.name} onClick={() => onPreview(item)} disabled={state === 'failed'}>{state !== 'ready' && <span>{state === 'failed' ? 'Image unavailable' : 'Loading image...'}</span>}<img loading="lazy" decoding="async" src={item.url} alt={item.type + ' - ' + item.name} onLoad={() => setState('ready')} onError={() => setState('failed')} style={{
      visibility: state === 'ready' ? 'visible' : 'hidden'
    }} referrerPolicy="no-referrer" /><Expand size={14} className="dc-expand" /></button>;
}
function Fullscreen({
  item,
  onClose
}) {
  const ref = useModalFocus({
    onClose
  });
  return <div className="dc-preview-backdrop"><section className="dc-preview" role="dialog" aria-modal="true" aria-label={'Image preview: ' + item.name} ref={ref} tabIndex={-1}><header><strong>{item.name}</strong><button aria-label="Close image preview" onClick={onClose}><X size={20} /></button></header><img src={item.url} alt={item.type + ' cleaning evidence'} referrerPolicy="no-referrer" /><a href={item.url} target="_blank" rel="noreferrer">Open original image</a></section></div>;
}
export default function DeepCleaningEvidenceDrawer({
  record,
  uploads,
  busy,
  error,
  onClose,
  onRetry
}) {
  const [tab, setTab] = useState('before'),
    [preview, setPreview] = useState(null),
    [downloadError, setDownloadError] = useState(''),
    [downloading, setDownloading] = useState(false);
  const closeRef = useRef(null);
  const controller = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const escape = e => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      controller.current?.abort();
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);
  const files = (uploads || []).filter(item => safeUrl(item.url));
  const photos = files.filter(item => ['before', 'after'].includes(item.type) && item.mime_type?.startsWith('image/'));
  const documents = files.filter(item => ['document', 'checklist'].includes(item.type));
  const other = files.filter(item => !photos.includes(item) && !documents.includes(item));
  const selected = photos.filter(item => item.type === tab);
  const events = Array.isArray(record.audit_trail) ? record.audit_trail : Array.isArray(record.events) ? record.events : [];
  async function download(item) {
    setDownloadError('');
    setDownloading(true);
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const res = await fetch(item.url, {
        signal: controller.current.signal,
        referrerPolicy: 'no-referrer'
      });
      if (!res.ok) throw Error('The authorized download has expired or is unavailable. Refresh evidence to try again.');
      const blob = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = blob;
      link.download = item.name || 'evidence';
      link.click();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    } catch (e) {
      if (e.name !== 'AbortError') setDownloadError(e.message);
    } finally {
      setDownloading(false);
    }
  }
  const facts = [{
    Icon: UserRound,
    title: 'FO Name',
    text: recordedFoName(record) || 'Not recorded',
    detail: recordedFoCode(record)
  }, {
    Icon: Paintbrush,
    title: 'Work Type',
    text: 'Deep Cleaning'
  }, {
    Icon: CalendarDays,
    title: 'Visit Date / Time',
    text: record.deep_cleaning_date || 'Not recorded',
    detail: record.visit_at ? stamp(record.visit_at) : 'Time not recorded'
  }, {
    Icon: CalendarDays,
    title: 'Scheduled Date',
    text: record.scheduled_date || 'Not recorded'
  }, {
    Icon: MapPin,
    title: 'Store Address',
    text: record.store?.address || record.store_address || 'Not recorded'
  }, {
    Icon: Images,
    title: 'Evidence / Supporting Docs',
    text: busy ? 'Loading?' : error ? 'Unavailable' : photos.length + ' photos - ' + documents.length + ' supporting files'
  }];
  return <aside className="dc-drawer dc-card" aria-label="Evidence Details"><header className="dc-drawer-header"><h2><ClipboardList size={19} />Evidence Details</h2><button ref={closeRef} aria-label="Close evidence details" onClick={onClose}><X size={19} /></button></header><div className="dc-drawer-scroll"><section className="dc-store-info"><span className="dc-store-icon"><Store size={23} /></span><div><h3>{record.store?.store_code} - {record.store?.store_name}</h3><small>Reliance Retail | {record.store?.state || 'State not recorded'}</small></div><span className="dc-status" data-status={recordedStatus(record)}>{recordedStatus(record)}</span></section>
 <section className="dc-facts">{facts.map(({
          Icon,
          title,
          text,
          detail
        }) => <div key={title}>{createElement(Icon, {
            size: 17
          })}<div><span>{title}</span><strong>{text}</strong>{detail && <small>{detail}</small>}</div></div>)}</section>
 <section className="dc-drawer-section"><div className="dc-card-heading"><h3>Photo Evidence</h3><div className="dc-photo-tabs" role="group" aria-label="Photo type">{['before', 'after'].map(type => <button key={type} aria-pressed={tab === type} onClick={() => setTab(type)}>{type === 'before' ? 'Before' : 'After'} ({photos.filter(item => item.type === type).length})</button>)}</div></div>{busy ? <p role="status" className="dc-empty">Checking authorization and loading private evidence?</p> : error ? <div role="alert" className="dc-empty">{error}<button onClick={onRetry}>Retry evidence</button></div> : <div className="dc-photo-grid">{selected.map(item => <Photo key={item.id} item={item} onPreview={setPreview} />)}{!selected.length && <p className="dc-empty">No {tab} photos recorded.</p>}</div>}</section>
 <section className="dc-drawer-section"><h3>Supporting Document</h3>{!busy && !error && !documents.length && <p className="dc-muted">No supporting documents recorded.</p>}{documents.map(item => <div className="dc-document" key={item.id}><FileText size={24} /><div><strong>{item.name}</strong><small>{item.mime_type}</small></div>{(item.mime_type === 'application/pdf' || item.mime_type?.startsWith('image/')) && <a className="dc-icon-button" aria-label={'Preview ' + item.name} href={item.url} target="_blank" rel="noreferrer"><Eye size={16} /></a>}<button aria-label={'Download ' + item.name} disabled={downloading} onClick={() => void download(item)}><Download size={16} /></button></div>)}{other.map(item => <p key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.type}: {item.name}</a></p>)}{downloadError && <p role="alert">{downloadError}</p>}</section>
 <section className="dc-drawer-section dc-audit"><h3><History size={15} />Audit Trail</h3>{record.submitted_at && <article><span className="dc-audit-dot" /><strong>Submission recorded</strong><small>{recordedFoName(record) || recordedFoCode(record) || 'Submitter not recorded'}</small><time dateTime={record.submitted_at}>{stamp(record.submitted_at)}</time></article>}{events.map((event, i) => <article key={event.id || i}><span className="dc-audit-dot" /><strong>{event.action || event.event_type || 'Recorded event'}</strong><small>{event.actor_name || event.actor_profile_id || 'Actor not recorded'}</small>{(event.created_at || event.occurred_at) && <time dateTime={event.created_at || event.occurred_at}>{stamp(event.created_at || event.occurred_at)}</time>}</article>)}{!record.submitted_at && !events.length && <p className="dc-muted">No audit events supplied by this report.</p>}</section></div><footer className="dc-drawer-footer"><span>Read-only evidence viewer</span><button disabled={busy} onClick={onRetry}>Refresh evidence</button></footer>{preview && <Fullscreen item={preview} onClose={() => setPreview(null)} />}</aside>;
}
