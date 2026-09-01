import { CheckCircle2, ChevronLeft, ChevronRight, Clipboard, Download, Eye, Link as LinkIcon, QrCode, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import {
  deleteHospitalFeedbackQr,
  generateHospitalFeedbackQr,
  getHospitalFeedbackQrLocations,
  listHospitalFeedbackQrs,
  previewHospitalFeedbackQr,
  reprintHospitalFeedbackQr,
} from '../services/api.js';
import { useAuth } from '../context/auth-context.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { canManageHospitalFeedbackQr } from '../utils/authRoles.js';
import { naturalOptionCompare } from '../utils/naturalSort.js';

const QR_PAGE_SIZE = 20;
const STATUS_OPTIONS = ['', 'active', 'inactive', 'replaced', 'revoked'];
const LEGACY_CLIENT_KEY = '__legacy__';
const LEGACY_NOT_SPECIFIED_FLOOR = 'Not Specified';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueOptions(rows, key, labelKey) {
  const seen = new Map();
  rows.forEach((row) => {
    const value = row[key] || '';
    const label = row[labelKey] || '';
    if (value && label && !seen.has(value)) seen.set(value, label);
  });
  return Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort(naturalOptionCompare);
}

function clientKey(row) {
  return row.parentClientId || LEGACY_CLIENT_KEY;
}

function normalizeLegacyFloorName(value) {
  return String(value || LEGACY_NOT_SPECIFIED_FLOOR).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function floorKey(row) {
  if (row.floorId) return row.floorId;
  if (clientKey(row) !== LEGACY_CLIENT_KEY) return '';
  return [
    'legacy-floor',
    row.hospitalId || 'hospital',
    row.blockId || 'block',
    normalizeLegacyFloorName(row.floorName),
  ].join(':');
}

function floorLabel(row) {
  return row.floorName || LEGACY_NOT_SPECIFIED_FLOOR;
}

function floorOptions(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    const value = floorKey(row);
    const label = floorLabel(row);
    if (value && label && !seen.has(value)) seen.set(value, label);
  });
  return Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort(naturalOptionCompare);
}

function realUuid(value) {
  return UUID_PATTERN.test(String(value || '')) ? value : '';
}

function clientOptions(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    const key = clientKey(row);
    const label = row.parentClientName || 'Legacy / Not Assigned';
    if (!seen.has(key)) seen.set(key, label);
  });
  return Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort(naturalOptionCompare);
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusBadgeClass(status) {
  switch (status) {
    case 'active': return 'bg-emerald-100 text-emerald-700';
    case 'inactive': return 'bg-slate-100 text-slate-600';
    case 'replaced': return 'bg-amber-100 text-amber-700';
    case 'revoked': return 'bg-rose-100 text-rose-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function downloadQr(qr) {
  if (!qr?.qrPngDataUrl) return;
  const link = document.createElement('a');
  link.href = qr.qrPngDataUrl;
  link.download = qr.suggestedFilename || `hospital-feedback-qr-${qr.qrId || 'download'}.png`;
  link.click();
}

function RegistryFilters({ filters, setFilter, clients, hospitals, blocks, floors, locations, onRefresh, loading }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_repeat(7,minmax(120px,0.8fr))_auto]">
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Search</span>
        <div className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={filters.search}
            onChange={(event) => setFilter('search', event.target.value)}
            placeholder="Search client, hospital, block, floor, location..."
            className="min-w-0 flex-1 text-sm font-semibold text-slate-700 outline-none"
          />
        </div>
      </label>
      <SelectField label="Client" value={filters.clientKey} onChange={(value) => setFilter('clientKey', value)} options={clients} />
      <SelectField label="Hospital" value={filters.hospitalId} onChange={(value) => setFilter('hospitalId', value)} options={hospitals} disabled={!filters.clientKey} />
      <SelectField label="Block" value={filters.blockId} onChange={(value) => setFilter('blockId', value)} options={blocks} disabled={!filters.hospitalId} />
      <SelectField label="Floor" value={filters.floorId} onChange={(value) => setFilter('floorId', value)} options={floors} disabled={!filters.blockId} />
      <SelectField label="Location" value={filters.locationId} onChange={(value) => setFilter('locationId', value)} options={locations} disabled={!filters.floorId} />
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Status</span>
        <select value={filters.status} onChange={(event) => setFilter('status', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100">
          {STATUS_OPTIONS.map((status) => <option key={status || 'all'} value={status}>{status ? status[0].toUpperCase() + status.slice(1) : 'All statuses'}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Generated from</span>
        <input type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100" />
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Generated to</span>
        <input type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100" />
      </label>
      <button type="button" onClick={onRefresh} disabled={loading} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </button>
    </div>
  );
}

function QrPreviewModal({ qr, loading, error, copied, canManageQr, onClose, onCopy, onReprint }) {
  if (!qr && !loading && !error) return null;
  const active = qr?.status === 'active';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 px-4 py-6">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-slate-950">QR Preview</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">
          {loading ? <div className="py-10 text-center text-sm font-bold text-slate-500"><span className="button-spinner" /> Loading QR preview...</div> : null}
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div> : null}
          {qr ? (
            <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-inner">
                <img src={qr.qrPngDataUrl} alt="Hospital Feedback QR preview" className="aspect-square w-full object-contain" />
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClass(qr.status)}`}>{qr.status}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">Version {qr.version}</span>
                </div>
                {[
                  ['Client', qr.parentClientName || 'Legacy / Not Assigned'],
                  ['Hospital', qr.hospitalName],
                  ['Block', qr.blockName],
                  ['Floor', qr.floorName],
                  ['Department', qr.departmentName],
                  ['Location', qr.locationName],
                  ['Generated', formatDateTime(qr.generatedAt)],
                  ['Print count', qr.printCount],
                ].filter(([, value]) => value !== '' && value !== null && value !== undefined).map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
                  </div>
                ))}
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Public URL</span>
                  <input readOnly value={qr.publicUrl || ''} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700" />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={onCopy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"><Clipboard className="h-4 w-4" />{copied ? 'Copied' : 'Copy URL'}</button>
                  {canManageQr ? (
                    <button type="button" onClick={() => onReprint(qr.qrId)} disabled={!active} title={active ? '' : 'Only active QR codes can be reprinted'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300"><Download className="h-4 w-4" />Reprint / Download</button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function DeleteQrModal({ qr, deleting, error, onCancel, onConfirm }) {
  if (!qr) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 px-4 py-6">
      <section className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-rose-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-700">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-950">Delete QR?</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                This will permanently delete this QR record. The existing printed QR will stop working. You can generate a new QR for this location afterward.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50">
            {[
              ['Client', qr.parentClientName || 'Legacy / Not Assigned'],
              ['Hospital', qr.hospitalName],
              ['Block', qr.blockName],
              ['Floor', qr.floorName],
              ['Location', qr.locationName],
            ].map(([label, value]) => (
              <div key={label} className="px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 text-sm font-bold text-slate-950">{value || '-'}</div>
              </div>
            ))}
          </div>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={deleting} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={onConfirm} disabled={deleting} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:bg-rose-300">
              {deleting ? <span className="button-spinner" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? 'Deleting...' : 'Delete QR'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

class QrRegistryErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('[hospital-feedback-qr] Registry render failed.', {
      reason: error?.message || error?.name || 'registry_render_failed',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-5">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            Unable to render generated QR codes. Please refresh.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function QrRegistryBody({ locations = [], refreshVersion, canManageQr, onQrDeleted }) {
  const [filters, setFilters] = useState({ search: '', clientKey: '', hospitalId: '', blockId: '', floorId: '', locationId: '', status: '', dateFrom: '', dateTo: '' });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: QR_PAGE_SIZE, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [localRefresh, setLocalRefresh] = useState(0);
  const [previewState, setPreviewState] = useState({ open: false, loading: false, qr: null, error: '' });
  const [deleteState, setDeleteState] = useState({ qr: null, deleting: false, error: '' });
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search.trim()), 350);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const clients = useMemo(() => clientOptions(locations), [locations]);
  const clientFilteredLocations = useMemo(
    () => locations.filter((row) => !filters.clientKey || clientKey(row) === filters.clientKey),
    [locations, filters.clientKey],
  );
  const hospitals = useMemo(() => uniqueOptions(clientFilteredLocations, 'hospitalId', 'hospitalName'), [clientFilteredLocations]);
  const hospitalFilteredLocations = useMemo(
    () => clientFilteredLocations.filter((row) => !filters.hospitalId || row.hospitalId === filters.hospitalId),
    [clientFilteredLocations, filters.hospitalId],
  );
  const blocks = useMemo(
    () => uniqueOptions(hospitalFilteredLocations, 'blockId', 'blockName'),
    [hospitalFilteredLocations],
  );
  const blockFilteredLocations = useMemo(
    () => hospitalFilteredLocations.filter((row) => !filters.blockId || row.blockId === filters.blockId),
    [hospitalFilteredLocations, filters.blockId],
  );
  const floors = useMemo(() => floorOptions(blockFilteredLocations), [blockFilteredLocations]);
  const floorFilteredLocations = useMemo(
    () => blockFilteredLocations.filter((row) => !filters.floorId || floorKey(row) === filters.floorId),
    [blockFilteredLocations, filters.floorId],
  );
  const locationFilterOptions = useMemo(
    () => floorFilteredLocations.map((row) => ({ value: row.id, label: row.locationName || row.locationCode || row.id })).sort(naturalOptionCompare),
    [floorFilteredLocations],
  );

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await listHospitalFeedbackQrs({
        search: debouncedSearch || undefined,
        parentClientId: filters.clientKey && filters.clientKey !== LEGACY_CLIENT_KEY ? filters.clientKey : undefined,
        hospitalId: filters.hospitalId || undefined,
        blockId: filters.blockId || undefined,
        floorId: realUuid(filters.floorId) || undefined,
        locationId: filters.locationId || undefined,
        status: filters.status || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        pageSize: QR_PAGE_SIZE,
      });
      setItems(result.items || []);
      setPagination(result.pagination || { page, pageSize: QR_PAGE_SIZE, total: 0, totalPages: 1 });
    } catch (loadError) {
      setError(loadError.message || 'Unable to load generated QR codes.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters.blockId, filters.clientKey, filters.dateFrom, filters.dateTo, filters.floorId, filters.hospitalId, filters.locationId, filters.status, page]);

  useEffect(() => {
    void Promise.resolve().then(loadRegistry);
  }, [loadRegistry, refreshVersion, localRefresh]);

  function setFilter(key, value) {
    setPage(1);
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'clientKey') {
        next.hospitalId = '';
        next.blockId = '';
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'hospitalId') {
        next.blockId = '';
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'blockId') {
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'floorId') next.locationId = '';
      return next;
    });
  }

  async function openPreview(qrId) {
    setPreviewState({ open: true, loading: true, qr: null, error: '' });
    try {
      const qr = await previewHospitalFeedbackQr(qrId);
      setPreviewState({ open: true, loading: false, qr, error: '' });
    } catch (previewError) {
      setPreviewState({ open: true, loading: false, qr: null, error: previewError.message || 'Unable to preview this QR.' });
    }
  }

  async function copyFromQr(qr) {
    if (!qr?.publicUrl || !navigator.clipboard) return;
    await navigator.clipboard.writeText(qr.publicUrl);
    setCopiedId(qr.qrId || 'preview');
    setTimeout(() => setCopiedId(''), 1600);
  }

  async function copyFromRow(item) {
    try {
      const qr = await previewHospitalFeedbackQr(item.qrId);
      await copyFromQr(qr);
    } catch (copyError) {
      setError(copyError.message || 'Unable to copy QR URL.');
      setNotice('');
    }
  }

  async function reprint(qrId) {
    try {
      const qr = await reprintHospitalFeedbackQr(qrId);
      downloadQr(qr);
      setPreviewState((current) => current.open && current.qr?.qrId === qrId ? { ...current, qr } : current);
      setLocalRefresh((value) => value + 1);
    } catch (reprintError) {
      const message = reprintError.message || 'Unable to reprint this QR.';
      if (previewState.open) setPreviewState((current) => ({ ...current, error: message }));
      else {
        setError(message);
        setNotice('');
      }
    }
  }

  async function confirmDelete() {
    const target = deleteState.qr;
    if (!target) return;
    setDeleteState((current) => ({ ...current, deleting: true, error: '' }));
    try {
      const result = await deleteHospitalFeedbackQr(target.qrId);
      setDeleteState({ qr: null, deleting: false, error: '' });
      setPreviewState((current) => current.qr?.qrId === target.qrId ? { open: false, loading: false, qr: null, error: '' } : current);
      setError('');
      setNotice(result.message || 'QR deleted successfully.');
      setLocalRefresh((value) => value + 1);
      onQrDeleted?.(target.qrId);
    } catch (deleteError) {
      setDeleteState((current) => ({
        ...current,
        deleting: false,
        error: deleteError.message || 'Unable to delete this QR.',
      }));
    }
  }

  return (
    <>
      <div className="space-y-4 p-5">
        <div className="flex justify-end">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{pagination.total || 0} records</span>
        </div>
        <RegistryFilters filters={filters} setFilter={setFilter} clients={clients} hospitals={hospitals} blocks={blocks} floors={floors} locations={locationFilterOptions} onRefresh={() => setLocalRefresh((value) => value + 1)} loading={loading} />
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div> : null}
        {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{notice}</div> : null}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[980px] w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">QR</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Hospital</th>
                <th className="px-4 py-3">Block / Floor</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Generated</th>
                <th className="px-4 py-3">Print Count</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr><td colSpan="9" className="px-4 py-8 text-center text-sm font-bold text-slate-500"><span className="button-spinner" /> Loading generated QR codes...</td></tr>
              ) : items.length ? items.map((item) => {
                const active = item.status === 'active';
                return (
                  <tr key={item.qrId} className="align-top">
                    <td className="px-4 py-3"><button type="button" onClick={() => openPreview(item.qrId)} className="grid h-12 w-12 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-qpms-700"><QrCode className="h-6 w-6" /></button></td>
                    <td className="px-4 py-3"><div className="font-bold text-slate-950">{item.parentClientName || 'Legacy / Not Assigned'}</div><div className="mt-1 text-xs font-semibold text-slate-500">v{item.version}</div></td>
                    <td className="px-4 py-3"><div className="font-bold text-slate-950">{item.hospitalName || '-'}</div>{item.hospitalCode ? <div className="mt-1 text-xs font-semibold text-slate-500">{item.hospitalCode}</div> : null}</td>
                    <td className="px-4 py-3"><div className="font-semibold text-slate-800">{item.blockName || '-'}</div><div className="mt-1 text-xs text-slate-500">{item.floorName || '-'}</div></td>
                    <td className="px-4 py-3"><div className="font-semibold text-slate-900">{item.locationName || '-'}</div>{item.departmentName ? <div className="mt-1 text-xs text-slate-500">{item.departmentName}</div> : null}{item.locationCode ? <div className="mt-1 text-xs font-bold text-slate-400">{item.locationCode}</div> : null}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                    <td className="px-4 py-3"><div className="font-semibold text-slate-800">{formatDateTime(item.generatedAt)}</div>{item.generatedByName ? <div className="mt-1 text-xs text-slate-500">By {item.generatedByName}</div> : null}{item.lastPrintedAt ? <div className="mt-1 text-xs text-slate-500">Last: {formatDateTime(item.lastPrintedAt)}</div> : null}</td>
                    <td className="px-4 py-3 font-bold text-slate-900">{item.printCount || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => openPreview(item.qrId)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-700"><Eye className="h-3.5 w-3.5" />Preview</button>
                        <button type="button" onClick={() => copyFromRow(item)} disabled={!active} title={active ? '' : 'Only active QR URLs can be copied'} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"><Clipboard className="h-3.5 w-3.5" />{copiedId === item.qrId ? 'Copied' : 'Copy'}</button>
                        {canManageQr ? (
                          <>
                            <button type="button" onClick={() => reprint(item.qrId)} disabled={!active} title={active ? '' : 'Only active QR codes can be reprinted'} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300"><Download className="h-3.5 w-3.5" />Reprint / Download</button>
                            <button type="button" onClick={() => setDeleteState({ qr: item, deleting: false, error: '' })} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="9" className="px-4 py-8 text-center text-sm font-bold text-slate-500">No generated QR codes found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-slate-500">
          <span>Page {pagination.page || 1} of {pagination.totalPages || 1}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="grid h-9 min-w-9 place-items-center rounded-lg bg-qpms-700 px-3 text-xs font-bold text-white">{pagination.page || page}</span>
            <button type="button" disabled={page >= (pagination.totalPages || 1) || loading} onClick={() => setPage((value) => value + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      {previewState.open ? (
        <QrPreviewModal
          qr={previewState.qr}
          loading={previewState.loading}
          error={previewState.error}
          copied={copiedId === (previewState.qr?.qrId || 'preview')}
          canManageQr={canManageQr}
          onClose={() => setPreviewState({ open: false, loading: false, qr: null, error: '' })}
          onCopy={() => copyFromQr(previewState.qr)}
          onReprint={reprint}
        />
      ) : null}
      <DeleteQrModal
        qr={deleteState.qr}
        deleting={deleteState.deleting}
        error={deleteState.error}
        onCancel={() => {
          if (!deleteState.deleting) setDeleteState({ qr: null, deleting: false, error: '' });
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function QrRegistry({ locations, refreshVersion, canManageQr, onQrDeleted }) {
  return (
    <section className="enterprise-card-compact overflow-hidden">
      <div className="border-b border-slate-100 bg-white px-5 py-4">
        <h2 className="text-base font-bold text-slate-950">Generated QR Codes</h2>
        <p className="mt-1 text-sm text-slate-500">Search and reprint existing Client Feedback QR codes.</p>
      </div>
      <QrRegistryErrorBoundary>
        <QrRegistryBody locations={locations} refreshVersion={refreshVersion} canManageQr={canManageQr} onQrDeleted={onQrDeleted} />
      </QrRegistryErrorBoundary>
    </section>
  );
}

export default function HospitalFeedbackQrGenerator() {
  usePageTitle('Client Feedback QR Generator');
  const { user } = useAuth();
  const canManageQr = canManageHospitalFeedbackQr(user);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState('');
  const [selection, setSelection] = useState({ clientKey: '', hospitalId: '', blockId: '', floorId: '', locationId: '' });
  const [generating, setGenerating] = useState(false);
  const [qr, setQr] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [registryRefresh, setRegistryRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    getHospitalFeedbackQrLocations()
      .then((rows) => {
        if (!active) return;
        setLocations(rows);
        setLoadingError('');
      })
      .catch((loadError) => {
        if (!active) return;
        setLoadingError(loadError.message || 'Unable to load hospital locations.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const clients = useMemo(() => clientOptions(locations), [locations]);
  const clientLocations = useMemo(
    () => locations.filter((row) => !selection.clientKey || clientKey(row) === selection.clientKey),
    [locations, selection.clientKey],
  );
  const hospitals = useMemo(() => uniqueOptions(clientLocations, 'hospitalId', 'hospitalName'), [clientLocations]);
  const hospitalLocations = useMemo(
    () => clientLocations.filter((row) => !selection.hospitalId || row.hospitalId === selection.hospitalId),
    [clientLocations, selection.hospitalId],
  );
  const blocks = useMemo(() => uniqueOptions(hospitalLocations, 'blockId', 'blockName'), [hospitalLocations]);
  const blockLocations = useMemo(
    () => hospitalLocations.filter((row) => !selection.blockId || row.blockId === selection.blockId),
    [hospitalLocations, selection.blockId],
  );
  const floors = useMemo(() => floorOptions(blockLocations), [blockLocations]);
  const floorLocations = useMemo(
    () => blockLocations.filter((row) => !selection.floorId || floorKey(row) === selection.floorId),
    [blockLocations, selection.floorId],
  );
  const locationOptions = useMemo(
    () => floorLocations
      .map((row) => ({ value: row.id, label: [row.locationName, row.locationType].filter(Boolean).join(' - ') }))
      .sort(naturalOptionCompare),
    [floorLocations],
  );
  const selectedLocation = locations.find((row) => row.id === selection.locationId);

  function updateSelection(key, value) {
    setQr(null);
    setMessage('');
    setError('');
    setSelection((current) => {
      const next = { ...current, [key]: value };
      if (key === 'clientKey') {
        next.hospitalId = '';
        next.blockId = '';
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'hospitalId') {
        next.blockId = '';
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'blockId') {
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'floorId') next.locationId = '';
      return next;
    });
  }

  async function onGenerate() {
    if (!selection.locationId) return;
    setGenerating(true);
    setError('');
    setMessage('');
    setCopied(false);
    try {
      const result = await generateHospitalFeedbackQr(selection.locationId);
      setQr(result);
      setMessage(result.message || 'QR is ready.');
      setRegistryRefresh((value) => value + 1);
    } catch (generateError) {
      setError(generateError.message || 'Unable to generate QR.');
    } finally {
      setGenerating(false);
    }
  }

  async function onCopy() {
    if (!qr?.public_url || !navigator.clipboard) return;
    await navigator.clipboard.writeText(qr.public_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function onDownload() {
    if (!qr?.qr_png_data_url) return;
    const link = document.createElement('a');
    link.href = qr.qr_png_data_url;
    link.download = `hospital-feedback-qr-${selection.locationId}.png`;
    link.click();
  }

  function onRegistryQrDeleted(deletedQrId) {
    if (qr?.id === deletedQrId) {
      setQr(null);
      setCopied(false);
    }
    setMessage('QR deleted successfully.');
    setRegistryRefresh((value) => value + 1);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Client Feedback QR Generator" />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {canManageQr ? <div className="enterprise-card-compact overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
            <h2 className="text-base font-bold text-slate-950">Select feedback location</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Generate the secure public QR for one active client hospital location.</p>
          </div>
          <div className="space-y-5 p-5">
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500">
                <span className="button-spinner" />
                Loading client hospital locations...
              </div>
            ) : loadingError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {loadingError}
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField label="Client" value={selection.clientKey} onChange={(value) => updateSelection('clientKey', value)} options={clients} />
                  <SelectField label="Hospital" value={selection.hospitalId} onChange={(value) => updateSelection('hospitalId', value)} options={hospitals} disabled={!selection.clientKey} />
                  <SelectField label="Block" value={selection.blockId} onChange={(value) => updateSelection('blockId', value)} options={blocks} disabled={!selection.hospitalId} />
                  <SelectField label="Floor" value={selection.floorId} onChange={(value) => updateSelection('floorId', value)} options={floors} disabled={!selection.blockId} />
                  <SelectField label="Location" value={selection.locationId} onChange={(value) => updateSelection('locationId', value)} options={locationOptions} disabled={!selection.floorId} />
                </div>

                {selectedLocation ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                      <div className="min-w-0">
                        <div className="font-bold text-slate-950">{selectedLocation.parentClientName || 'Legacy / Not Assigned'}</div>
                        <div className="mt-1 leading-6">{[selectedLocation.hospitalName, selectedLocation.blockName, selectedLocation.floorName, selectedLocation.locationName].filter(Boolean).join(' / ')}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={!selection.clientKey || !selection.hospitalId || !selection.blockId || !selection.floorId || !selection.locationId || generating}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-qpms-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-qpms-800 disabled:bg-slate-400 md:w-auto"
                >
                  {generating ? <span className="button-spinner" /> : <QrCode className="h-4 w-4" />}
                  Generate QR
                </button>
              </>
            )}

            {message ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            ) : null}
          </div>
        </div> : null}

        <aside className="enterprise-card-compact overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-slate-950">QR Preview</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">Preview and PNG download use the same image.</p>
            </div>
            {qr?.active ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">Active</span> : null}
          </div>

          <div className="p-5">
            <div className="grid aspect-square place-items-center rounded-2xl border border-slate-200 bg-white p-4 shadow-inner">
              {qr?.qr_png_data_url ? (
                <img src={qr.qr_png_data_url} alt="Hospital Feedback QR" className="h-full w-full object-contain" />
              ) : (
                <div className="grid justify-items-center text-center text-sm font-semibold text-slate-400">
                  <QrCode className="mb-3 h-12 w-12 text-slate-300" />
                  Select a location and generate a QR.
                </div>
              )}
            </div>

            {qr?.public_url ? (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Public URL</span>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <LinkIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      readOnly
                      value={qr.public_url}
                      className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                    />
                  </div>
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button type="button" onClick={onCopy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                    <Clipboard className="h-4 w-4" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button type="button" onClick={onDownload} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">
                    <Download className="h-4 w-4" />
                    Download PNG
                  </button>
                  <button type="button" onClick={onGenerate} disabled={generating} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:text-slate-400">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      <QrRegistry locations={locations} refreshVersion={registryRefresh} canManageQr={canManageQr} onQrDeleted={onRegistryQrDeleted} />
    </div>
  );
}
