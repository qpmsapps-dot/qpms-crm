import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Image,
  Images,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  User,
  X,
} from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { useAuth } from '../context/auth-context.js';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { authenticatedApiRequest } from '../services/api.js';
import { isDemoUser } from '../utils/demoAccess.js';

const TARGET_BUSINESSES = ['Reliance Retail', 'IFMS'];
const BUSINESS_QUERY_VALUES = ['Reliance Retail', 'Reliance', 'IFMS'];
const BUSINESS_ALIASES = {
  RELIANCERETAIL: 'Reliance Retail',
  RELIANCE: 'Reliance Retail',
  IFMS: 'IFMS',
};
const PAGE_SIZE = 60;

function text(value) {
  return String(value ?? '').trim();
}

function businessKey(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function normalizeBusiness(value) {
  return BUSINESS_ALIASES[businessKey(value)] || text(value);
}

function targetBusiness(value) {
  const normalized = normalizeBusiness(value);
  return TARGET_BUSINESSES.includes(normalized) ? normalized : '';
}

function objectMetadata(row) {
  return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function firstText(...values) {
  return values.map(text).find(Boolean) || '';
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function deepCleaningStage(upload = {}) {
  const metadata = objectMetadata(upload);
  const role = text(upload.upload_role).toLowerCase();
  const stage = text(
    metadata.deep_cleaning_stage ||
      metadata.cleaning_stage ||
      metadata.photo_stage,
  ).toLowerCase();
  if (stage.includes('before') || role.includes('before')) return 'before';
  if (stage.includes('after') || role.includes('after')) return 'after';
  if (role.includes('document') || role.includes('pdf')) return 'document';
  return 'other';
}

function isImageUpload(upload = {}) {
  const type = text(upload.file_type).toLowerCase();
  const name = text(upload.file_name || upload.file_url).toLowerCase();
  return type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
}

function uploadName(upload = {}) {
  return firstText(upload.file_name, upload.file_url?.split('/').pop(), 'Deep Cleaning image');
}

function uploadPath(upload = {}) {
  const bucket = upload.storage_bucket || 'fo-activity-uploads';
  return text(upload.file_url).replace(new RegExp(`^${bucket}/`), '').replace(/^\/+/, '');
}

async function signedUploadUrl(upload) {
  if (!upload?.file_url) return '';
  if (/^https?:\/\//i.test(upload.file_url)) return upload.file_url;
  if (!supabase?.storage) return '';
  const bucket = upload.storage_bucket || 'fo-activity-uploads';
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(uploadPath(upload), 60 * 60);
  if (error) throw error;
  return data?.signedUrl || '';
}

function uniqueOptions(values) {
  return Array.from(new Set(values.map(text).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function buildRecordKey(row, fallback) {
  return text(row?.submission_id || row?.id || row?.local_id || row?.file_url || fallback);
}

function mergeDeepCleaningRecords({ submissions, uploads, stores, profiles, visits }) {
  const storesByCode = new Map(stores.map((store) => [businessKey(store.store_code), store]));
  const profilesByCode = new Map(
    profiles.flatMap((profile) =>
      [profile.employee_code, profile.username]
        .map((value) => [businessKey(value), profile])
        .filter(([key]) => key),
    ),
  );
  const visitsById = new Map(visits.map((visit) => [text(visit.id), visit]));
  const submissionsById = new Map(submissions.map((submission) => [text(submission.id), submission]));
  const records = new Map();

  uploads.filter(isImageUpload).forEach((upload, index) => {
    const submission = upload.submission_id ? submissionsById.get(text(upload.submission_id)) : null;
    const metadata = objectMetadata(upload);
    const submissionMetadata = objectMetadata(submission);
    const storeCode = firstText(
      upload.store_code,
      submission?.store_code,
      metadata.store_code,
      submissionMetadata.store_code,
    );
    const store = storesByCode.get(businessKey(storeCode));
    const storeMetadata = objectMetadata(store);
    const employeeCode = firstText(upload.employee_code, upload.fo_user_id, submission?.employee_code, submission?.fo_user_id);
    const profile = profilesByCode.get(businessKey(employeeCode));
    const visit = visitsById.get(text(upload.site_visit_id || submission?.site_visit_id));
    const visitMetadata = objectMetadata(visit);
    const resolvedBusiness = targetBusiness(
      firstText(
        metadata.business,
        submissionMetadata.business,
        store?.business,
        profile?.business,
        visitMetadata.business,
        visitMetadata.store_business,
      ),
    );
    if (!resolvedBusiness) return;

    const key = submission?.id ? `submission-${submission.id}` : `upload-${buildRecordKey(upload, index)}`;
    const current = records.get(key) || {
      id: key,
      submission,
      uploads: [],
      before: [],
      after: [],
      documents: [],
      other: [],
      business: resolvedBusiness,
      storeCode,
      storeName: firstText(
        submission?.store_name,
        metadata.store_name,
        store?.store_name,
        storeMetadata.site_name,
        visit?.store_name,
        visit?.site_name,
        visitMetadata.site_name,
      ),
      clientName: firstText(submissionMetadata.client_name, metadata.client_name, store?.client_name, visit?.client_name),
      state: firstText(submission?.state, submissionMetadata.state, metadata.state, store?.state, profile?.state, visit?.state),
      city: firstText(submissionMetadata.city, metadata.city, storeMetadata.city, visit?.city, visitMetadata.city),
      person: firstText(
        metadata.uploaded_by_name,
        submissionMetadata.uploaded_by_name,
        profile?.display_name,
        profile?.full_name,
        employeeCode,
      ),
      date: firstText(submission?.submitted_at, upload.uploaded_at, upload.created_at),
      status: firstText(submission?.status, metadata.review_status, submissionMetadata.web_upload_status, 'submitted'),
      remarks: firstText(submission?.remarks, metadata.remarks, submissionMetadata.remarks),
    };
    const enrichedUpload = {
      ...upload,
      stage: deepCleaningStage(upload),
      displayName: uploadName(upload),
    };
    current.uploads.push(enrichedUpload);
    if (enrichedUpload.stage === 'before') current.before.push(enrichedUpload);
    else if (enrichedUpload.stage === 'after') current.after.push(enrichedUpload);
    else if (enrichedUpload.stage === 'document') current.documents.push(enrichedUpload);
    else current.other.push(enrichedUpload);
    records.set(key, current);
  });

  return Array.from(records.values()).sort(
    (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
  );
}

function SummaryCard({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-qpms-50 text-qpms-700">
          {createElement(icon, { className: 'h-5 w-5' })}
        </span>
      </div>
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="text-xs font-black uppercase tracking-wide text-slate-400">
      {label}
      {children}
    </label>
  );
}

function ImageStrip({ label, uploads, signedUrls, onPreview }) {
  return (
    <div>
      <p className="text-xs font-black text-slate-900">{label} ({uploads.length})</p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {uploads.length ? uploads.slice(0, 8).map((upload, index) => {
          const key = text(upload.id || upload.file_url || index);
          const url = signedUrls[key] || '';
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPreview(upload)}
              className="focus-ring grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-300"
              title={upload.displayName}
            >
              {url ? <img src={url} alt={upload.displayName} className="h-full w-full object-cover" loading="lazy" /> : <Image className="h-7 w-7" />}
            </button>
          );
        }) : (
          <span className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-400">
            None
          </span>
        )}
      </div>
    </div>
  );
}

function Lightbox({ file, url, onClose, onPrevious, onNext, hasMultiple }) {
  if (!file) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-950">{file.displayName}</p>
            <p className="text-xs font-semibold text-slate-500">{file.stage || 'image'} - {formatDate(file.uploaded_at || file.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="focus-ring grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close preview">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative grid min-h-[60vh] place-items-center bg-slate-950">
          {url ? (
            <img src={url} alt={file.displayName} className="max-h-[74vh] w-auto max-w-full object-contain" />
          ) : (
            <div className="p-10 text-center text-sm font-semibold text-white">Preview URL is unavailable.</div>
          )}
          {hasMultiple ? (
            <>
              <button type="button" onClick={onPrevious} className="focus-ring absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-900">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button type="button" onClick={onNext} className="focus-ring absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-900">
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function DeepCleaning() {
  usePageTitle('Deep Cleaning');
  const { user } = useAuth();
  const useDemoBackendRead = isDemoUser(user);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [signedUrls, setSignedUrls] = useState({});
  const [previewUpload, setPreviewUpload] = useState(null);
  const [filters, setFilters] = useState({
    business: 'All',
    state: 'All',
    city: 'All',
    status: 'All',
    search: '',
    fromDate: '',
    toDate: '',
  });

  const loadRecords = useCallback(async () => {
    if (!useDemoBackendRead && (!isSupabaseConfigured || !supabase)) {
      setRecords([]);
      setError('Supabase is not configured for this build.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (useDemoBackendRead) {
        const response = await authenticatedApiRequest({
          method: 'GET',
          url: '/api/deep-cleaning/records',
        });
        setRecords(mergeDeepCleaningRecords({
          submissions: response.data?.submissions || [],
          uploads: response.data?.uploads || [],
          stores: response.data?.stores || [],
          profiles: response.data?.profiles || [],
          visits: response.data?.visits || [],
        }));
        setVisibleCount(PAGE_SIZE);
        return;
      }
      const [submissionsRes, uploadsRes, storesRes, profilesRes, visitsRes] = await Promise.all([
        supabase
          .from('fo_activity_submissions')
          .select('*')
          .eq('activity_type', 'deep_cleaning')
          .order('submitted_at', { ascending: false })
          .limit(1000),
        supabase
          .from('fo_activity_uploads')
          .select('*')
          .or('activity_type.eq.deep_cleaning,upload_role.ilike.%deep_cleaning%')
          .order('uploaded_at', { ascending: false })
          .limit(1500),
        supabase
          .from('store_master')
          .select('id,store_code,store_name,client_name,state,business,latitude,longitude,gps_accuracy,status,metadata')
          .in('business', BUSINESS_QUERY_VALUES)
          .limit(5000),
        supabase
          .from('profiles')
          .select('employee_code,username,full_name,display_name,business,state,role,designation,department')
          .in('business', BUSINESS_QUERY_VALUES)
          .limit(5000),
        supabase
          .from('fo_site_visits')
          .select('id,store_code,store_name,site_name,client_name,state,employee_code,fo_user_id,check_in_time,metadata')
          .order('check_in_time', { ascending: false })
          .limit(3000),
      ]);
      for (const response of [submissionsRes, uploadsRes, storesRes, profilesRes, visitsRes]) {
        if (response.error) throw response.error;
      }
      setRecords(mergeDeepCleaningRecords({
        submissions: submissionsRes.data || [],
        uploads: uploadsRes.data || [],
        stores: storesRes.data || [],
        profiles: profilesRes.data || [],
        visits: visitsRes.data || [],
      }));
      setVisibleCount(PAGE_SIZE);
    } catch (loadError) {
      console.warn('[myQPMS Deep Cleaning] load failed', loadError);
      setError(loadError.message || 'Unable to load Deep Cleaning records.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [useDemoBackendRead]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadRecords();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords]);

  const filteredRecords = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return records.filter((record) => {
      if (filters.business !== 'All' && record.business !== filters.business) return false;
      if (filters.state !== 'All' && record.state !== filters.state) return false;
      if (filters.city !== 'All' && record.city !== filters.city) return false;
      if (filters.status !== 'All' && record.status !== filters.status) return false;
      const recordDate = dateInput(record.date);
      if (filters.fromDate && recordDate && recordDate < filters.fromDate) return false;
      if (filters.toDate && recordDate && recordDate > filters.toDate) return false;
      if (!search) return true;
      return [
        record.storeCode,
        record.storeName,
        record.business,
        record.state,
        record.city,
        record.clientName,
        record.person,
        record.status,
        record.remarks,
      ].join(' ').toLowerCase().includes(search);
    });
  }, [filters, records]);

  const visibleRecords = useMemo(() => filteredRecords.slice(0, visibleCount), [filteredRecords, visibleCount]);
  const allVisibleUploads = useMemo(() => visibleRecords.flatMap((record) => record.uploads), [visibleRecords]);

  useEffect(() => {
    let cancelled = false;
    async function signVisibleImages() {
      const next = {};
      const missing = allVisibleUploads.filter((upload) => !signedUrls[text(upload.id || upload.file_url)]);
      await Promise.all(missing.map(async (upload) => {
        const key = text(upload.id || upload.file_url);
        try {
          next[key] = await signedUploadUrl(upload);
        } catch (signError) {
          console.warn('[myQPMS Deep Cleaning] thumbnail signing failed', signError);
          next[key] = '';
        }
      }));
      if (!cancelled && Object.keys(next).length) {
        setSignedUrls((current) => ({ ...current, ...next }));
      }
    }
    if (allVisibleUploads.length) signVisibleImages();
    return () => {
      cancelled = true;
    };
  }, [allVisibleUploads, signedUrls]);

  const options = useMemo(() => ({
    states: uniqueOptions(records.map((record) => record.state)),
    cities: uniqueOptions(records.map((record) => record.city)),
    statuses: uniqueOptions(records.map((record) => record.status)),
  }), [records]);

  const summary = useMemo(() => {
    const siteKeys = new Set(records.map((record) => `${record.business}:${record.storeCode || record.storeName}`));
    return {
      totalSites: siteKeys.size,
      totalRecords: records.length,
      totalImages: records.reduce((sum, record) => sum + record.uploads.length, 0),
      reliance: records.filter((record) => record.business === 'Reliance Retail').length,
      ifms: records.filter((record) => record.business === 'IFMS').length,
    };
  }, [records]);

  const previewFiles = previewUpload
    ? filteredRecords.find((record) => record.uploads.some((upload) => upload === previewUpload))?.uploads || [previewUpload]
    : [];
  const previewIndex = previewFiles.indexOf(previewUpload);
  const previewKey = text(previewUpload?.id || previewUpload?.file_url);

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setVisibleCount(PAGE_SIZE);
  }

  function movePreview(delta) {
    if (!previewFiles.length) return;
    const nextIndex = (previewIndex + delta + previewFiles.length) % previewFiles.length;
    setPreviewUpload(previewFiles[nextIndex]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-qpms-600">Operations</p>
          <h1 className="mt-1 text-3xl font-black text-slate-950">Deep Cleaning</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-500">
            Deep Cleaning image gallery for Reliance Retail and IFMS activity submissions.
          </p>
        </div>
        <button type="button" onClick={loadRecords} disabled={loading} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-700 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-qpms-800 disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Total Sites" value={summary.totalSites} icon={Store} />
        <SummaryCard label="Records" value={summary.totalRecords} icon={Sparkles} />
        <SummaryCard label="Images" value={summary.totalImages} icon={Images} />
        <SummaryCard label="Reliance Retail" value={summary.reliance} icon={MapPin} />
        <SummaryCard label="IFMS" value={summary.ifms} icon={User} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-7">
          <FilterField label="Business">
            <select value={filters.business} onChange={(event) => setFilter('business', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400">
              <option value="All">Reliance Retail + IFMS</option>
              {TARGET_BUSINESSES.map((business) => <option key={business}>{business}</option>)}
            </select>
          </FilterField>
          <FilterField label="State">
            <select value={filters.state} onChange={(event) => setFilter('state', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400">
              <option>All</option>
              {options.states.map((state) => <option key={state}>{state}</option>)}
            </select>
          </FilterField>
          <FilterField label="City">
            <select value={filters.city} onChange={(event) => setFilter('city', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400">
              <option>All</option>
              {options.cities.map((city) => <option key={city}>{city}</option>)}
            </select>
          </FilterField>
          <FilterField label="Status">
            <select value={filters.status} onChange={(event) => setFilter('status', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400">
              <option>All</option>
              {options.statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </FilterField>
          <FilterField label="From">
            <input type="date" value={filters.fromDate} onChange={(event) => setFilter('fromDate', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400" />
          </FilterField>
          <FilterField label="To">
            <input type="date" value={filters.toDate} onChange={(event) => setFilter('toDate', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400" />
          </FilterField>
          <FilterField label="Site Search">
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} placeholder="Code, name, person" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400" />
            </div>
          </FilterField>
        </div>
      </section>

      {loading ? (
        <div className="grid min-h-80 place-items-center rounded-2xl border border-slate-200 bg-white">
          <div className="text-center">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-qpms-700" />
            <p className="mt-3 text-sm font-black text-slate-700">Loading Deep Cleaning images...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{error}</div>
      ) : !filteredRecords.length ? (
        <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <div>
            <Image className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-3 text-base font-black text-slate-800">No Deep Cleaning images found.</p>
            <p className="mt-1 text-sm font-semibold text-slate-500">Try clearing filters or confirm FO activity uploads exist for Reliance Retail / IFMS.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleRecords.map((record) => (
              <article key={record.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">{record.business}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">{record.status || 'submitted'}</span>
                    </div>
                    <h2 className="mt-2 truncate text-lg font-black text-slate-950">{record.storeName || record.storeCode || 'Deep Cleaning record'}</h2>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{record.storeCode || '--'} - {record.clientName || '--'}</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
                    <CalendarDays className="h-4 w-4" />
                    {formatDate(record.date)}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                  {[
                    ['State / City', [record.state, record.city].filter(Boolean).join(' / ') || '--'],
                    ['Assigned Person', record.person || '--'],
                    ['Remarks', record.remarks || '--'],
                    ['Images', `${record.uploads.length} total`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="font-black uppercase tracking-wide text-slate-400">{label}</p>
                      <p className="mt-1 break-words font-semibold text-slate-700">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <ImageStrip label="Before Images" uploads={record.before} signedUrls={signedUrls} onPreview={setPreviewUpload} />
                  <ImageStrip label="After Images" uploads={record.after} signedUrls={signedUrls} onPreview={setPreviewUpload} />
                  {record.other.length ? <ImageStrip label="Other Images" uploads={record.other} signedUrls={signedUrls} onPreview={setPreviewUpload} /> : null}
                </div>
              </article>
            ))}
          </div>
          {visibleCount < filteredRecords.length ? (
            <div className="flex justify-center">
              <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="focus-ring rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
                Load more ({filteredRecords.length - visibleCount} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}

      <Lightbox
        file={previewUpload}
        url={signedUrls[previewKey] || ''}
        onClose={() => setPreviewUpload(null)}
        onPrevious={() => movePreview(-1)}
        onNext={() => movePreview(1)}
        hasMultiple={previewFiles.length > 1}
      />
    </div>
  );
}
