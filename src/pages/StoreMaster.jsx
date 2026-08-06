import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit,
  Eye,
  Map,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Store,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import {
  createStoreMasterRecord,
  getStoreMaster,
  updateStoreMasterRecord,
} from '../services/api.js';
import { useAuth } from '../context/auth-context.js';
import { demoReadOnlyMessage, isReadOnlyUser } from '../utils/demoAccess.js';
import { buildStoreMasterExportRows, fetchAllStoreMasterRows } from '../utils/storeMasterExport.js';

const DEFAULT_STATES = ['TN', 'AP', 'KA', 'KL', 'TG'];
const DEFAULT_BUSINESSES = [
  'Standalone',
  'Reliance Retail',
  'IFMS',
  'Reliance',
  'Private Clients',
  'DME',
  'AP DSH',
  'TN Government',
  'Osmania Hospitals',
  'Airport',
  'Retail',
  'Government',
  'Private Hospital',
];
const PAGE_LIMIT = 8;
const SOUTH_INDIA_BOUNDS = {
  minLat: 7,
  maxLat: 19,
  minLng: 74,
  maxLng: 86,
};

function text(value) {
  return String(value ?? '').trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDateTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadgeClass(status) {
  return /^active$/i.test(String(status || 'Active'))
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
    : 'bg-rose-50 text-rose-700 ring-rose-100';
}

function isValidLatLng(latitude, longitude) {
  const lat = numberOrNull(latitude);
  const lng = numberOrNull(longitude);
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function outsideSouthIndia(latitude, longitude) {
  const lat = numberOrNull(latitude);
  const lng = numberOrNull(longitude);
  if (lat === null || lng === null) return false;
  return (
    lat < SOUTH_INDIA_BOUNDS.minLat ||
    lat > SOUTH_INDIA_BOUNDS.maxLat ||
    lng < SOUTH_INDIA_BOUNDS.minLng ||
    lng > SOUTH_INDIA_BOUNDS.maxLng
  );
}

function emptyForm() {
  return {
    store_name: '',
    site_name: '',
    store_code: '',
    client_name: '',
    business: '',
    state: '',
    latitude: '',
    longitude: '',
    gps_accuracy: '',
    status: 'Active',
  };
}

function rowToForm(row) {
  return {
    store_name: text(row?.store_name),
    site_name: text(row?.site_name || row?.metadata?.site_name || row?.store_name),
    store_code: text(row?.store_code),
    client_name: text(row?.client_name),
    business: text(row?.business),
    state: text(row?.state),
    latitude: row?.latitude ?? '',
    longitude: row?.longitude ?? '',
    gps_accuracy: row?.gps_accuracy ?? '',
    status: text(row?.status) || 'Active',
  };
}

function validateForm(form) {
  const errors = {};
  for (const field of ['store_name', 'site_name', 'store_code', 'client_name', 'business', 'state']) {
    if (!text(form[field])) errors[field] = 'Required';
  }
  const latitude = numberOrNull(form.latitude);
  const longitude = numberOrNull(form.longitude);
  const gpsAccuracy = numberOrNull(form.gps_accuracy);
  if (latitude === null) errors.latitude = 'Latitude required';
  else if (latitude < -90 || latitude > 90) errors.latitude = 'Latitude must be between -90 and 90';
  if (longitude === null) errors.longitude = 'Longitude required';
  else if (longitude < -180 || longitude > 180) errors.longitude = 'Longitude must be between -180 and 180';
  if (gpsAccuracy === null) errors.gps_accuracy = 'GPS Accuracy required';
  else if (gpsAccuracy < 0) errors.gps_accuracy = 'GPS Accuracy cannot be negative';
  if (!['Active', 'Inactive'].includes(form.status)) errors.status = 'Status required';
  return errors;
}

function uniqueOptions(defaults, values) {
  return Array.from(new Set([...defaults, ...(values || [])].map(text).filter(Boolean)));
}

function StoreKpiCard({ label, value, subtext, icon, tone }) {
  const IconComponent = icon;
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{subtext}</p>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[tone] || tones.blue}`}>
          <IconComponent className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function Field({ label, required, error, children }) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-600">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </span>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-[11px] font-semibold text-rose-600">{error}</p> : null}
    </label>
  );
}

function StoreDrawer({ mode, row, form, errors, saving, stateOptions, businessOptions, onChange, onClose, onSave }) {
  if (!mode) return null;
  const readOnly = mode === 'view';
  const validCoordinates = isValidLatLng(form.latitude, form.longitude);
  const mapUrl = validCoordinates
    ? `https://www.google.com/maps?q=${encodeURIComponent(`${form.latitude},${form.longitude}`)}&z=15&output=embed`
    : '';
  const lastEditor = row?.metadata?.last_edited_by || row?.created_by_full_name || '';
  const title = mode === 'create' ? 'Add Store' : mode === 'view' ? 'View Store' : 'Edit Store';
  const saveLabel = mode === 'create' ? 'Create Store' : 'Save Changes';

  const inputClass =
    'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-qpms-500 focus:ring-2 focus:ring-qpms-100 disabled:bg-slate-50 disabled:text-slate-500';

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <button type="button" onClick={onClose} className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Field label="Store Name" required error={errors.store_name}>
          <input disabled={readOnly} value={form.store_name} onChange={(event) => onChange('store_name', event.target.value)} className={inputClass} />
        </Field>
        <Field label="Site Name" required error={errors.site_name}>
          <input disabled={readOnly} value={form.site_name} onChange={(event) => onChange('site_name', event.target.value)} className={inputClass} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store Code" required error={errors.store_code}>
            <input disabled={readOnly} value={form.store_code} onChange={(event) => onChange('store_code', event.target.value)} className={inputClass} />
          </Field>
          <Field label="Client Name" required error={errors.client_name}>
            <input disabled={readOnly} value={form.client_name} onChange={(event) => onChange('client_name', event.target.value)} className={inputClass} />
          </Field>
          <Field label="Business" required error={errors.business}>
            <select disabled={readOnly} value={form.business} onChange={(event) => onChange('business', event.target.value)} className={inputClass}>
              <option value="">Select Business</option>
              {uniqueOptions([], [...businessOptions, form.business]).map((business) => (
                <option key={business}>{business}</option>
              ))}
            </select>
          </Field>
          <Field label="State" required error={errors.state}>
            <select disabled={readOnly} value={form.state} onChange={(event) => onChange('state', event.target.value)} className={inputClass}>
              <option value="">Select State</option>
              {uniqueOptions([], [...stateOptions, form.state]).map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </Field>
          <Field label="Latitude" required error={errors.latitude}>
            <input disabled={readOnly} value={form.latitude} onChange={(event) => onChange('latitude', event.target.value)} className={inputClass} />
          </Field>
          <Field label="Longitude" required error={errors.longitude}>
            <input disabled={readOnly} value={form.longitude} onChange={(event) => onChange('longitude', event.target.value)} className={inputClass} />
          </Field>
          <Field label="GPS Accuracy (m)" required error={errors.gps_accuracy}>
            <input disabled={readOnly} value={form.gps_accuracy} onChange={(event) => onChange('gps_accuracy', event.target.value)} className={inputClass} />
          </Field>
          <Field label="Status" required error={errors.status}>
            <select disabled={readOnly} value={form.status} onChange={(event) => onChange('status', event.target.value)} className={inputClass}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </Field>
        </div>

        {validCoordinates && outsideSouthIndia(form.latitude, form.longitude) ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Coordinates appear outside the expected South India operating region. Admin confirmation is required while saving.
          </p>
        ) : null}

        <section>
          <p className="text-xs font-black text-slate-600">Location Preview</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {validCoordinates ? (
              <iframe
                title="Location Preview"
                src={mapUrl}
                className="h-44 w-full"
                loading="lazy"
              />
            ) : (
              <div className="grid h-44 place-items-center text-sm font-semibold text-slate-500">
                GPS location missing
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600">
          <p className="font-black text-slate-500">Last Updated</p>
          <p className="mt-1">
            {formatDateTime(row?.updated_at)}{lastEditor ? ` by ${lastEditor}` : ''}
          </p>
          {row?.linked_site_visits ? (
            <p className="mt-2 text-amber-700">
              Linked Site Visits: {row.linked_site_visits}. Changes affect future visits only.
            </p>
          ) : null}
        </section>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-5">
        <button type="button" onClick={onClose} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        {readOnly ? (
          <button type="button" onClick={onClose} className="focus-ring h-10 rounded-xl bg-qpms-700 text-sm font-black text-white hover:bg-qpms-800">
            Close
          </button>
        ) : (
          <button type="button" onClick={onSave} disabled={saving || Object.keys(errors).length > 0} className="focus-ring h-10 rounded-xl bg-qpms-700 text-sm font-black text-white hover:bg-qpms-800 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? 'Saving...' : saveLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default function StoreMaster() {
  usePageTitle('Store Master');
  const { user } = useAuth();
  const demoReadOnly = isReadOnlyUser(user);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    totalStores: 0,
    activeStores: 0,
    gpsAvailable: 0,
    gpsMissing: 0,
    statesCovered: 0,
  });
  const [filterOptions, setFilterOptions] = useState({ states: [], businesses: [], clients: [] });
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_LIMIT, total: 0, from: 0, to: 0 });
  const [filters, setFilters] = useState({
    search: '',
    state: 'All States',
    business: 'All Business',
    client: 'All Clients',
    gpsStatus: 'All',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [drawerMode, setDrawerMode] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const errors = useMemo(() => (drawerMode === 'view' ? {} : validateForm(form)), [drawerMode, form]);
  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / PAGE_LIMIT));
  const stateOptions = uniqueOptions(DEFAULT_STATES, filterOptions.states);
  const businessOptions = uniqueOptions(DEFAULT_BUSINESSES, filterOptions.businesses);

  async function loadStores(page = pagination.page) {
    setLoading(true);
    setMessage('');
    try {
      const payload = await getStoreMaster({
        ...filters,
        page,
        limit: PAGE_LIMIT,
      });
      setRows(payload.rows || []);
      setSummary(payload.summary || summary);
      setFilterOptions(payload.filterOptions || { states: [], businesses: [], clients: [] });
      setPagination(payload.pagination || { page, limit: PAGE_LIMIT, total: 0, from: 0, to: 0 });
    } catch (error) {
      setMessage(error.message || 'Unable to load Store Master.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadStores(1);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.state, filters.business, filters.client, filters.gpsStatus]);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters({
      search: '',
      state: 'All States',
      business: 'All Business',
      client: 'All Clients',
      gpsStatus: 'All',
    });
  }

  function openDrawer(mode, row = null) {
    if (demoReadOnly && ['create', 'edit'].includes(mode)) {
      setMessage(demoReadOnlyMessage);
      return;
    }
    setDrawerMode(mode);
    setSelectedRow(row);
    setForm(row ? rowToForm(row) : emptyForm());
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveStore() {
    if (Object.keys(errors).length) return;
    if (demoReadOnly) {
      setMessage(demoReadOnlyMessage);
      return;
    }
    if (outsideSouthIndia(form.latitude, form.longitude)) {
      const confirmed = window.confirm('Coordinates appear outside South India. Save anyway?');
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        latitude: numberOrNull(form.latitude),
        longitude: numberOrNull(form.longitude),
        gps_accuracy: numberOrNull(form.gps_accuracy),
      };
      if (drawerMode === 'create') {
        await createStoreMasterRecord(payload);
        setMessage('Store created successfully.');
      } else {
        await updateStoreMasterRecord(selectedRow.id, payload);
        setMessage('Store updated successfully.');
      }
      setDrawerMode(null);
      await loadStores(pagination.page);
    } catch (error) {
      setMessage(error.response?.data?.message || error.message || 'Store save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    setMessage('Preparing Store Master export...');
    try {
      const allRows = await fetchAllStoreMasterRows(getStoreMaster, filters);
      const exportRows = buildStoreMasterExportRows(allRows, formatDateTime);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), 'Store Master');
      XLSX.writeFile(workbook, 'Store_Master.xlsx');
      setMessage(`${allRows.length.toLocaleString('en-IN')} stores exported successfully.`);
    } catch (error) {
      setMessage(error.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  function openMap(row) {
    if (!isValidLatLng(row.latitude, row.longitude)) {
      setMessage('GPS missing.');
      return;
    }
    window.open(`https://www.google.com/maps?q=${encodeURIComponent(`${row.latitude},${row.longitude}`)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-950">Store Master</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">Manage store and site master data</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[1.6fr_repeat(4,1fr)]">
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">Search</span>
            <div className="mt-1 flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Search store/site/code/client..." className="h-full min-w-0 flex-1 text-sm font-bold text-slate-700 outline-none" />
            </div>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">State</span>
            <select value={filters.state} onChange={(event) => updateFilter('state', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 outline-none">
              <option>All States</option>
              {stateOptions.map((state) => <option key={state}>{state}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">Business</span>
            <select value={filters.business} onChange={(event) => updateFilter('business', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 outline-none">
              <option>All Business</option>
              {businessOptions.map((business) => <option key={business}>{business}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">Client</span>
            <select value={filters.client} onChange={(event) => updateFilter('client', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 outline-none">
              <option>All Clients</option>
              {(filterOptions.clients || []).map((client) => <option key={client}>{client}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">GPS Status</span>
            <select value={filters.gpsStatus} onChange={(event) => updateFilter('gpsStatus', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 outline-none">
              <option>All</option>
              <option>GPS Available</option>
              <option>GPS Missing</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={resetFilters} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Reset
          </button>
          <button type="button" onClick={exportExcel} disabled={exporting} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">
            <Download className="h-4 w-4" /> {exporting ? 'Preparing export...' : 'Export Excel'}
          </button>
          {demoReadOnly ? (
            <span className="inline-flex h-10 items-center rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-black text-amber-800">
              Tender Demo - read-only
            </span>
          ) : (
            <button type="button" onClick={() => openDrawer('create')} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-qpms-700 px-4 text-sm font-black text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-800">
              <Plus className="h-4 w-4" /> Add Store
            </button>
          )}
        </div>
      </section>

      {message ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">{message}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StoreKpiCard label="Total Stores" value={summary.totalStores || 0} subtext={`Across ${summary.statesCovered || 0} States`} icon={Store} tone="blue" />
        <StoreKpiCard label="Active Stores" value={summary.activeStores || 0} subtext={summary.totalStores ? `${Math.round((summary.activeStores / summary.totalStores) * 100)}% of total` : '0% of total'} icon={CheckCircle2} tone="green" />
        <StoreKpiCard label="GPS Available" value={summary.gpsAvailable || 0} subtext={summary.totalStores ? `${Math.round((summary.gpsAvailable / summary.totalStores) * 100)}% of total` : '0% of total'} icon={MapPin} tone="green" />
        <StoreKpiCard label="GPS Missing" value={summary.gpsMissing || 0} subtext={summary.totalStores ? `${Math.round((summary.gpsMissing / summary.totalStores) * 100)}% of total` : '0% of total'} icon={MapPin} tone="amber" />
        <StoreKpiCard label="States Covered" value={summary.statesCovered || 0} subtext="South India" icon={Map} tone="violet" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <h2 className="text-base font-black text-slate-950">Store Master Records</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-500">
              <tr>
                {['Store Code', 'Store Name', 'Site Name', 'Client Name', 'Business', 'State', 'Latitude', 'Longitude', 'GPS Accuracy', 'Updated At', 'Status', 'Actions'].map((heading) => (
                  <th key={heading} className="px-3 py-3">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-3 font-black text-slate-800">{row.store_code || '--'}</td>
                  <td className="px-3 py-3 font-bold">{row.store_name || '--'}</td>
                  <td className="px-3 py-3">{row.site_name || '--'}</td>
                  <td className="px-3 py-3">{row.client_name || '--'}</td>
                  <td className="px-3 py-3">{row.business || '--'}</td>
                  <td className="px-3 py-3">{row.state || '--'}</td>
                  <td className="px-3 py-3">{row.latitude ?? '--'}</td>
                  <td className="px-3 py-3">{row.longitude ?? '--'}</td>
                  <td className="px-3 py-3">{row.gps_accuracy ?? '--'}</td>
                  <td className="px-3 py-3">{formatDateTime(row.updated_at)}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${statusBadgeClass(row.status)}`}>
                      {row.status || 'Active'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openDrawer('view', row)} className="focus-ring inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-black text-slate-600 hover:bg-slate-50">
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      {!demoReadOnly ? (
                        <button type="button" onClick={() => openDrawer('edit', row)} className="focus-ring inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-black text-slate-600 hover:bg-slate-50">
                          <Edit className="h-3.5 w-3.5" /> Edit
                        </button>
                      ) : null}
                      <button type="button" disabled={!isValidLatLng(row.latitude, row.longitude)} onClick={() => openMap(row)} className="focus-ring inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                        <Map className="h-3.5 w-3.5" /> Map
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-sm font-semibold text-slate-500">
                    {loading ? 'Loading Store Master...' : 'No stores found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-4 text-sm font-semibold text-slate-500">
          <span>Showing {pagination.from || 0} to {pagination.to || 0} of {pagination.total || 0} entries</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pagination.page <= 1} onClick={() => loadStores(pagination.page - 1)} className="focus-ring h-9 rounded-lg border border-slate-200 px-3 font-black text-slate-600 disabled:opacity-40">‹</button>
            <span className="grid h-9 min-w-9 place-items-center rounded-lg border border-qpms-300 bg-qpms-50 px-3 font-black text-qpms-700">{pagination.page}</span>
            <button type="button" disabled={pagination.page >= totalPages} onClick={() => loadStores(pagination.page + 1)} className="focus-ring h-9 rounded-lg border border-slate-200 px-3 font-black text-slate-600 disabled:opacity-40">›</button>
          </div>
        </div>
      </section>

      <StoreDrawer
        mode={drawerMode}
        row={selectedRow}
        form={form}
        errors={errors}
        saving={saving}
        stateOptions={stateOptions}
        businessOptions={businessOptions}
        onChange={updateForm}
        onClose={() => setDrawerMode(null)}
        onSave={saveStore}
      />
    </div>
  );
}
