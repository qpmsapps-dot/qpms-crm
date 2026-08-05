import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Filter,
  Info,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Search,
  Star,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { useAuth } from '../context/auth-context.js';
import { getHospitalFeedbackDashboard, getHospitalFeedbackQrLocations } from '../services/api.js';
import { isReadOnlyUser } from '../utils/demoAccess.js';
import { naturalOptionCompare } from '../utils/naturalSort.js';
import {
  checklistRowsFromResponses,
  commentExcerpt,
  compareHierarchy,
  formatIndiaDateTime,
  formatReportDate,
  maskIndianMobile,
  performanceClassName,
  pct,
  ratingDistributionFromBlocks,
  reportMetrics,
  hasProvidedName,
  respondentName,
} from '../utils/hospitalFeedbackReport.js';

const LEGACY_CLIENT_KEY = '__legacy__';
const tabs = ['Overview', 'Floor-wise Report', 'Location-wise Report', 'Comments & Names', 'Checklist Summary', 'Tickets'];
const ratingOptions = ['', '5', '4', '3', '2', '1'];
const responseFilterOptions = [
  { value: 'all', label: 'All responses' },
  { value: 'named', label: 'Named responses' },
  { value: 'anonymous', label: 'Anonymous responses' },
  { value: 'hasComment', label: 'Has comment' },
  { value: 'noComment', label: 'No comment' },
];
const ticketStatusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'New' },
  { value: 'accepted', label: 'Acknowledged' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved_awaiting_confirmation', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];
const ticketAssignmentOptions = [
  { value: '', label: 'All assignments' },
  { value: 'required', label: 'Assignment Required' },
  { value: 'assigned', label: 'Assigned' },
];

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function clientKey(row) {
  return row.parentClientId || LEGACY_CLIENT_KEY;
}

function uniqueOptions(rows, key, labelKey, fallback = '') {
  const seen = new Map();
  rows.forEach((row) => {
    const value = row[key] || '';
    const label = row[labelKey] || fallback;
    if (value && label && !seen.has(value)) seen.set(value, label);
  });
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort(naturalOptionCompare);
}

function clientOptions(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    const value = clientKey(row);
    const label = row.parentClientName || 'Legacy / Not Assigned';
    if (!seen.has(value)) seen.set(value, label);
  });
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort(naturalOptionCompare);
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 disabled:bg-slate-100 disabled:text-slate-400">
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ReportCard({ title, subtitle, children, className = '', action = null }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-black text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs font-semibold text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function KpiCard({ label, value, helper, icon: Icon, tone = 'blue' }) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone] || 'bg-slate-50 text-slate-700';
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-black text-slate-700">{label}</p>
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</p>
          {helper ? <p className="mt-1 text-xs font-semibold text-slate-500">{helper}</p> : null}
        </div>
      </div>
    </article>
  );
}

function ratingBadge(rating) {
  const value = Number(rating || 0);
  const color = value <= 1 ? 'bg-rose-50 text-rose-700 ring-rose-200' : value === 2 ? 'bg-orange-50 text-orange-700 ring-orange-200' : value === 3 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ring-1 ${color}`}><Star className="h-3 w-3 fill-current" />{value}</span>;
}

function TinyProgress({ value, tone = 'emerald' }) {
  const color = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'orange' ? 'bg-orange-500' : tone === 'blue' ? 'bg-blue-500' : 'bg-emerald-500';
  return (
    <div className="h-2.5 rounded-full bg-slate-100">
      <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} />
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-black text-slate-700">{title}</p>
      {body ? <p className="mt-1 text-xs font-semibold text-slate-500">{body}</p> : null}
    </div>
  );
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || '-';
}

function ticketStatusLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'open') return 'New';
  if (normalized === 'accepted') return 'Acknowledged';
  if (normalized === 'resolved_awaiting_confirmation') return 'Resolved';
  return titleCase(value);
}

function ticketAge(value, now = new Date()) {
  const start = value ? new Date(value).getTime() : 0;
  if (!start || Number.isNaN(start)) return '-';
  const minutes = Math.max(0, Math.floor((now.getTime() - start) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

function DataTable({ columns, rows, emptyTitle = 'No rows found.' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-xs">
        <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
          <tr>{columns.map((column) => <th key={column.key} className="px-3 py-3">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length ? rows.map((row) => (
            <tr key={row.id || row.key || row.locationId || row.floorId || row.blockId}>
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-3 align-top font-semibold text-slate-700">
                  {column.render ? column.render(row) : row[column.key] ?? '-'}
                </td>
              ))}
            </tr>
          )) : (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm font-bold text-slate-500">{emptyTitle}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilterPanel({ open, filters, setFilter, clients, hospitals, blocks, floors, locationOptions, onApply, onClear, loading }) {
  if (!open) return null;
  return (
    <section className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Date From</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-semibold" /></label>
        <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Date To</span><input type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-semibold" /></label>
        <SelectField label="Client" value={filters.clientKey} onChange={(value) => setFilter('clientKey', value)} options={clients} />
        <SelectField label="Hospital" value={filters.hospitalId} onChange={(value) => setFilter('hospitalId', value)} options={hospitals} disabled={!filters.clientKey} />
        <SelectField label="Block" value={filters.blockId} onChange={(value) => setFilter('blockId', value)} options={blocks} disabled={!filters.hospitalId} />
        <SelectField label="Floor" value={filters.floorId} onChange={(value) => setFilter('floorId', value)} options={floors} disabled={!filters.blockId} />
        <SelectField label="Location" value={filters.locationId} onChange={(value) => setFilter('locationId', value)} options={locationOptions} disabled={!filters.floorId} />
        <SelectField label="Rating" value={filters.rating} onChange={(value) => setFilter('rating', value)} options={ratingOptions.filter(Boolean).map((value) => ({ value, label: `${value} Star` }))} />
        <SelectField label="Feedback Status" value={filters.needsAttention} onChange={(value) => setFilter('needsAttention', value)} options={[{ value: 'true', label: 'Needs Attention' }, { value: 'false', label: 'Normal' }]} />
        <div className="flex items-end gap-2">
          <button type="button" onClick={onApply} disabled={loading} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-qpms-700 px-4 py-2 text-sm font-black text-white disabled:bg-slate-400"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Apply</button>
          <button type="button" onClick={onClear} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">Clear Filters</button>
        </div>
      </div>
    </section>
  );
}

function RatingSummary({ distribution, trend }) {
  const colors = { 5: 'emerald', 4: 'blue', 3: 'amber', 2: 'orange', 1: 'rose' };
  const total = distribution.reduce((sum, row) => sum + row.count, 0);
  const hasMultipleDays = (trend || []).length > 1;
  return (
    <ReportCard title="Rating Summary">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-black text-slate-700">Rating Distribution</h3>
          <div className="mt-3 space-y-3">
            {distribution.map((row) => (
              <div key={row.rating} className="grid grid-cols-[58px_1fr_78px] items-center gap-3">
                <span className="text-xs font-bold text-slate-500">{row.label}</span>
                <TinyProgress value={row.percentage} tone={colors[row.rating]} />
                <span className="text-right text-xs font-black text-slate-700">{row.count} ({row.percentage}%)</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-sm font-black text-slate-800"><span>Total</span><span>{total}</span></div>
        </div>
        <div>
          <h3 className="text-xs font-black text-slate-700">Daily Rating Trend <span className="font-semibold text-slate-400">(Average Rating)</span></h3>
          {hasMultipleDays ? (
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[1, 5]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value, name, item) => [value, name, item.payload.totalResponses ? `${item.payload.totalResponses} responses` : '']} />
                  <Line type="monotone" dataKey="averageRating" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} name="Average rating" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : trend?.length === 1 ? (
            <div className="mt-4 rounded-xl bg-blue-50 p-5 text-center">
              <p className="text-xs font-black text-blue-700">{trend[0].date}</p>
              <p className="mt-2 text-3xl font-black text-blue-900">{Number(trend[0].averageRating || 0).toFixed(2)}</p>
              <p className="text-xs font-semibold text-blue-700">{trend[0].totalResponses || 0} responses</p>
            </div>
          ) : <EmptyState title="No trend data" body="Daily ratings will appear when feedback is received." />}
        </div>
      </div>
    </ReportCard>
  );
}

function BlockPerformance({ blocks, onOpenLocations }) {
  return (
    <ReportCard title="Block / Location Performance" action={<button type="button" onClick={onOpenLocations} className="no-print text-xs font-black text-qpms-700">View location-wise performance</button>}>
      {blocks.length ? (
        <div className="grid gap-3 md:grid-cols-3">
          {blocks.map((block) => (
            <article key={block.blockId || block.key} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-slate-800"><Building2 className="h-5 w-5 text-qpms-700" />{block.blockName || 'Block'}</div>
              <p className="mt-4 text-3xl font-black text-emerald-700">{Number(block.averageRating || 0).toFixed(2)} <span className="text-sm text-slate-500">/5</span></p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{block.totalResponses ? `${block.totalResponses} responses` : 'No feedback'}</p>
              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-bold">
                <span className="text-slate-500">Needs Attention</span>
                <span className="text-orange-600">{block.needsAttention || 0}</span>
              </div>
              <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ${performanceClassName(block.performance)}`}>{block.performance || 'No Data'}</span>
            </article>
          ))}
        </div>
      ) : <EmptyState title="No block feedback" body="Blocks will appear when feedback is available for the selected filters." />}
    </ReportCard>
  );
}

function CommentsTable({ rows, limit = null }) {
  const visible = limit ? rows.slice(0, limit) : rows;
  return (
    <DataTable
      rows={visible}
      emptyTitle="No comments or names found for the selected filters."
      columns={[
        { key: 'name', label: 'Name', render: (row) => respondentName(row) },
        { key: 'rating', label: 'Rating', render: (row) => ratingBadge(row.rating) },
        { key: 'comments', label: 'Comment', render: (row) => limit ? commentExcerpt(row.comments) : (row.comments || 'No comment provided.') },
        { key: 'blockName', label: 'Block' },
        { key: 'floorName', label: 'Floor' },
        { key: 'locationName', label: 'Location' },
        { key: 'submittedAt', label: 'Submitted At', render: (row) => formatIndiaDateTime(row.submittedAt || row.submitted_at) },
      ]}
    />
  );
}

function ChecklistCard({ checklistRows, metrics }) {
  return (
    <ReportCard title="Checklist Analysis" subtitle="Compliance">
      {checklistRows.length ? (
        <div className="space-y-4">
          {checklistRows.slice(0, 6).map((row) => (
            <div key={row.key}>
              <div className="mb-1 flex justify-between gap-3 text-xs font-black text-slate-700">
                <span>{row.item}</span>
                <span>{row.percentage}% ({row.positive}/{row.answered})</span>
              </div>
              <TinyProgress value={row.percentage} />
            </div>
          ))}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-500">Overall Checklist Completion</p>
            <p className="mt-1 text-2xl font-black text-emerald-700">{metrics.checklistCompletion}%</p>
            <p className="text-xs font-semibold text-slate-500">{metrics.checklistAnswered} of {metrics.total} responses</p>
          </div>
        </div>
      ) : (
        <EmptyState title="Future-ready checklist report" body="Checklist reporting will appear when checklist questions are enabled in the public feedback form." />
      )}
    </ReportCard>
  );
}

function NeedsAttentionCard({ rows, onOpen }) {
  const lowRows = rows.filter((row) => Number(row.rating) < 4);
  return (
    <ReportCard title="Needs Attention / Low Rated Feedback" action={<button type="button" onClick={onOpen} className="no-print text-xs font-black text-qpms-700">View all Needs Attention</button>}>
      <DataTable
        rows={lowRows.slice(0, 5)}
        emptyTitle="No low-rated feedback found."
        columns={[
          { key: 'rating', label: 'Rating', render: (row) => ratingBadge(row.rating) },
          { key: 'comments', label: 'Feedback Excerpt', render: (row) => commentExcerpt(row.comments) },
          { key: 'locationName', label: 'Location', render: (row) => [row.blockName, row.floorName, row.locationName].filter(Boolean).join(', ') || '-' },
          { key: 'submittedAt', label: 'Submitted At', render: (row) => formatIndiaDateTime(row.submittedAt || row.submitted_at) },
        ]}
      />
    </ReportCard>
  );
}

export default function HospitalFeedbackDashboard() {
  const { user } = useAuth();
  const readOnlyDemo = isReadOnlyUser(user);
  usePageTitle('Soft Services Feedback Report');
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ dateFrom: monthStart(), dateTo: today(), clientKey: '', hospitalId: '', blockId: '', floorId: '', locationId: '', rating: '', needsAttention: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');
  const [locationSearch, setLocationSearch] = useState('');
  const [locationPage, setLocationPage] = useState(1);
  const [responseFilter, setResponseFilter] = useState('all');
  const [ticketFilters, setTicketFilters] = useState({ status: '', assignment: '', search: '' });
  const locationPageSize = 12;

  useEffect(() => {
    getHospitalFeedbackQrLocations().then(setLocations).catch(() => setLocations([]));
  }, []);

  const clientFiltered = useMemo(() => locations.filter((row) => !filters.clientKey || clientKey(row) === filters.clientKey), [locations, filters.clientKey]);
  const hospitalFiltered = useMemo(() => clientFiltered.filter((row) => !filters.hospitalId || row.hospitalId === filters.hospitalId), [clientFiltered, filters.hospitalId]);
  const blockFiltered = useMemo(() => hospitalFiltered.filter((row) => !filters.blockId || row.blockId === filters.blockId), [hospitalFiltered, filters.blockId]);
  const floorFiltered = useMemo(() => blockFiltered.filter((row) => !filters.floorId || row.floorId === filters.floorId), [blockFiltered, filters.floorId]);
  const clients = useMemo(() => clientOptions(locations), [locations]);
  const hospitals = useMemo(() => uniqueOptions(clientFiltered, 'hospitalId', 'hospitalName'), [clientFiltered]);
  const blocks = useMemo(() => uniqueOptions(hospitalFiltered, 'blockId', 'blockName'), [hospitalFiltered]);
  const floors = useMemo(() => uniqueOptions(blockFiltered, 'floorId', 'floorName'), [blockFiltered]);
  const locationOptions = useMemo(() => floorFiltered.map((row) => ({ value: row.id, label: row.locationName || row.locationCode || row.id })).sort(naturalOptionCompare), [floorFiltered]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getHospitalFeedbackDashboard({
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        parentClientId: filters.clientKey && filters.clientKey !== LEGACY_CLIENT_KEY ? filters.clientKey : undefined,
        hospitalId: filters.hospitalId || undefined,
        blockId: filters.blockId || undefined,
        floorId: filters.floorId || undefined,
        locationId: filters.locationId || undefined,
        rating: filters.rating || undefined,
        needsAttention: filters.needsAttention || undefined,
      });
      setData(result);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load feedback report.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void Promise.resolve().then(loadDashboard);
  }, [loadDashboard]);

  function setFilter(key, value) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'clientKey') Object.assign(next, { hospitalId: '', blockId: '', floorId: '', locationId: '' });
      if (key === 'hospitalId') Object.assign(next, { blockId: '', floorId: '', locationId: '' });
      if (key === 'blockId') Object.assign(next, { floorId: '', locationId: '' });
      if (key === 'floorId') next.locationId = '';
      return next;
    });
  }

  function clearFilters() {
    setFilters({ dateFrom: monthStart(), dateTo: today(), clientKey: '', hospitalId: '', blockId: '', floorId: '', locationId: '', rating: '', needsAttention: '' });
  }

  const summary = data?.summary || {};
  const metrics = reportMetrics(data || {});
  const distribution = ratingDistributionFromBlocks(data?.blockPerformance || []);
  const blockRows = useMemo(() => [...(data?.blockPerformance || [])].sort(compareHierarchy), [data]);
  const floorRows = useMemo(() => [...(data?.floorPerformance || [])].sort(compareHierarchy), [data]);
  const locationRows = useMemo(() => [...(data?.locationPerformance || [])].sort(compareHierarchy), [data]);
  const responseRows = useMemo(() => {
    const rows = [...(data?.recentNeedsAttention || []), ...(data?.recentFeedback || [])];
    return Array.from(new Map(rows.map((row, index) => [row.id || `${row.submittedAt || index}-${row.locationId || index}`, row])).values())
      .sort((a, b) => new Date(b.submittedAt || b.submitted_at || 0) - new Date(a.submittedAt || a.submitted_at || 0));
  }, [data]);
  const commentsTabRows = useMemo(() => responseRows.filter((row) => {
    if (filters.needsAttention === 'true' && Number(row.rating) >= 4) return false;
    if (filters.needsAttention === 'false' && Number(row.rating) < 4) return false;
    if (responseFilter === 'named') return hasProvidedName(row);
    if (responseFilter === 'anonymous') return !hasProvidedName(row);
    if (responseFilter === 'hasComment') return Boolean(String(row.comments || '').trim());
    if (responseFilter === 'noComment') return !String(row.comments || '').trim();
    return true;
  }), [responseRows, filters.needsAttention, responseFilter]);
  const checklistRows = checklistRowsFromResponses(responseRows);
  const filteredLocationRows = locationRows.filter((row) => {
    const query = locationSearch.trim().toLowerCase();
    if (!query) return true;
    return [row.blockName, row.floorName, row.locationName].some((value) => String(value || '').toLowerCase().includes(query));
  });
  const pagedLocations = filteredLocationRows.slice((locationPage - 1) * locationPageSize, locationPage * locationPageSize);
  const ticketRows = useMemo(() => [...(data?.publicCleanlinessComplaints || [])]
    .filter((row) => row.ticketNumber)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)), [data]);
  const filteredTicketRows = useMemo(() => {
    const query = ticketFilters.search.trim().toLowerCase();
    return ticketRows.filter((row) => {
      if (ticketFilters.status && row.currentStatus !== ticketFilters.status) return false;
      if (ticketFilters.assignment === 'required' && !row.assignmentRequired) return false;
      if (ticketFilters.assignment === 'assigned' && row.assignmentRequired) return false;
      if (!query) return true;
      return [row.ticketNumber, row.blockName, row.floorName, row.locationName, row.comment]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [ticketRows, ticketFilters]);
  const ticketSummary = useMemo(() => ({
    total: filteredTicketRows.length,
    newCount: filteredTicketRows.filter((row) => row.currentStatus === 'open').length,
    inProgress: filteredTicketRows.filter((row) => row.currentStatus === 'in_progress').length,
    resolved: filteredTicketRows.filter((row) => ['resolved_awaiting_confirmation', 'closed'].includes(row.currentStatus)).length,
    assignmentRequired: filteredTicketRows.filter((row) => row.assignmentRequired).length,
  }), [filteredTicketRows]);
  const contextParts = [
    filters.clientKey ? clients.find((item) => item.value === filters.clientKey)?.label : 'All Clients',
    filters.hospitalId ? hospitals.find((item) => item.value === filters.hospitalId)?.label : 'All Hospitals',
    `${formatReportDate(filters.dateFrom)} - ${formatReportDate(filters.dateTo)}`,
  ].filter(Boolean);
  const activeChips = [
    filters.blockId && blocks.find((item) => item.value === filters.blockId)?.label,
    filters.floorId && floors.find((item) => item.value === filters.floorId)?.label,
    filters.locationId && locationOptions.find((item) => item.value === filters.locationId)?.label,
    filters.rating && `${filters.rating} Star`,
    filters.needsAttention === 'true' && 'Needs Attention',
    filters.needsAttention === 'false' && 'Normal',
  ].filter(Boolean);

  const kpis = [
    { label: 'Total Feedback', value: metrics.total, helper: 'Responses received', icon: MessageSquareText, tone: 'blue' },
    { label: 'Average Rating', value: `${metrics.averageRating.toFixed(2)} /5`, helper: 'Out of 5', icon: Star, tone: 'green' },
    { label: 'Five-Star %', value: `${metrics.fiveStarPercentage}%`, helper: `${metrics.fiveStarCount} five-star responses`, icon: BarChart3, tone: 'violet' },
    { label: 'Needs Attention', value: metrics.needsAttention, helper: 'Below 4-star ratings', icon: AlertTriangle, tone: 'amber' },
    { label: 'Named Responses', value: `${metrics.namedCount} (${metrics.namedPercentage}%)`, helper: 'With optional names', icon: UserRound, tone: 'blue' },
    { label: 'Checklist Completion Rate', value: `${metrics.checklistCompletion}%`, helper: `${metrics.checklistAnswered} of ${metrics.total} responses`, icon: ClipboardCheck, tone: 'green' },
  ];
  const cleanlinessKpis = [
    { label: 'Clean Responses', value: metrics.cleanCount, helper: 'Survey-only clean reports', icon: CheckCircle2, tone: 'green' },
    { label: 'Not Clean Responses', value: metrics.notCleanCount, helper: 'Public cleanliness complaints', icon: AlertTriangle, tone: 'rose' },
    { label: 'Cleanliness Percentage', value: `${metrics.cleanlinessPercentage}%`, helper: 'Clean responses / total feedback', icon: BarChart3, tone: 'blue' },
    { label: 'Complaint Tickets', value: metrics.complaintTicketCount, helper: `${metrics.openComplaintCount} open, ${metrics.resolvedComplaintCount} resolved`, icon: MessageSquareText, tone: 'amber' },
    { label: 'Assignment Required', value: metrics.assignmentRequiredComplaintCount, helper: 'Unassigned public complaint tickets', icon: ClipboardCheck, tone: 'violet' },
  ];

  const floorColumns = [
    { key: 'blockName', label: 'Block' },
    { key: 'floorName', label: 'Floor' },
    { key: 'totalResponses', label: 'Total Responses' },
    { key: 'averageRating', label: 'Average Rating', render: (row) => Number(row.averageRating || 0).toFixed(2) },
    { key: 'fiveStar', label: 'Five-Star %', render: (row) => `${pct(row.fiveStar, row.totalResponses, 1)}%` },
    { key: 'needsAttention', label: 'Needs Attention' },
    { key: 'named', label: 'Named Responses', render: () => '0' },
    { key: 'checklist', label: 'Checklist Completion', render: () => '0%' },
    { key: 'performance', label: 'Performance', render: (row) => <span className={`rounded-full px-2.5 py-1 text-xs font-black ring-1 ${performanceClassName(row.performance)}`}>{row.performance}</span> },
  ];
  const locationColumns = [
    { key: 'blockName', label: 'Block' },
    { key: 'floorName', label: 'Floor' },
    { key: 'locationName', label: 'Location' },
    { key: 'totalResponses', label: 'Total Responses' },
    { key: 'averageRating', label: 'Average Rating', render: (row) => Number(row.averageRating || 0).toFixed(2) },
    { key: 'fiveStar', label: 'Five-Star %', render: (row) => `${pct(row.fiveStar, row.totalResponses, 1)}%` },
    { key: 'needsAttention', label: 'Needs Attention' },
    { key: 'latest', label: 'Latest Feedback', render: () => '-' },
    { key: 'performance', label: 'Performance', render: (row) => <span className={`rounded-full px-2.5 py-1 text-xs font-black ring-1 ${performanceClassName(row.performance)}`}>{row.performance}</span> },
  ];
  const complaintColumns = [
    { key: 'ticketNumber', label: 'Ticket Number', render: (row) => row.ticketNumber || '-' },
    { key: 'rating', label: 'Rating', render: (row) => row.rating ? ratingBadge(row.rating) : '-' },
    { key: 'comment', label: 'Comment', render: (row) => commentExcerpt(row.comment, 140) },
    { key: 'blockName', label: 'Block' },
    { key: 'floorName', label: 'Floor' },
    { key: 'locationName', label: 'Location' },
    { key: 'createdAt', label: 'Created At', render: (row) => formatIndiaDateTime(row.createdAt) },
    { key: 'currentStatus', label: 'Current Status', render: (row) => ticketStatusLabel(row.currentStatus) },
    { key: 'assignmentStatus', label: 'Assignment', render: (row) => row.assignmentStatus || '-' },
    { key: 'currentEscalationLevel', label: 'Escalation', render: (row) => row.assignmentRequired ? 'Not Started' : titleCase(row.currentEscalationLevel) },
    { key: 'currentOwnerRole', label: 'Current Owner Role', render: (row) => row.assignmentRequired ? 'Unassigned' : titleCase(row.currentOwnerRole) },
    { key: 'resolutionTimeMinutes', label: 'Resolution Time', render: (row) => row.resolutionTimeMinutes == null ? '-' : `${row.resolutionTimeMinutes} min` },
  ];
  const ticketColumns = [
    { key: 'ticketNumber', label: 'Ticket Number', render: (row) => row.ticketNumber || '-' },
    { key: 'createdAt', label: 'Created At', render: (row) => formatIndiaDateTime(row.createdAt) },
    { key: 'age', label: 'Age', render: (row) => ticketAge(row.createdAt) },
    { key: 'blockName', label: 'Block' },
    { key: 'floorName', label: 'Floor' },
    { key: 'locationName', label: 'Location' },
    { key: 'comment', label: 'Complaint', render: (row) => commentExcerpt(row.comment, 160) },
    { key: 'respondentName', label: 'Respondent Name', render: (row) => row.respondentName || 'Anonymous' },
    { key: 'respondentMobile', label: 'Mobile', render: (row) => maskIndianMobile(row.respondentMobile) },
    { key: 'currentStatus', label: 'Current Status', render: (row) => ticketStatusLabel(row.currentStatus) },
    { key: 'assignmentStatus', label: 'Assignment', render: (row) => row.assignmentStatus || '-' },
    { key: 'currentEscalationLevel', label: 'Current Escalation Level', render: (row) => row.assignmentRequired ? 'Not Started' : titleCase(row.currentEscalationLevel) },
    { key: 'currentOwnerRole', label: 'Current Owner Role', render: (row) => row.assignmentRequired ? 'Unassigned' : titleCase(row.currentOwnerRole) },
    { key: 'action', label: 'Action', render: () => <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">View in ticketing</span> },
  ];

  return (
    <div className="min-h-screen bg-slate-50/80 px-1 pb-8 text-slate-900 print:bg-white">
      <style>{`
        @media print {
          .no-print, aside, nav { display: none !important; }
          main, body { background: white !important; }
          .print-card { break-inside: avoid; box-shadow: none !important; }
          .print-break { break-before: page; }
        }
      `}</style>
      <header className="rounded-2xl bg-gradient-to-br from-white to-blue-50/60 px-5 py-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Soft Services Feedback Report</h1>
            <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">Consolidated public feedback insights including ratings, names, comments and checklist responses.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-black text-qpms-700">
              <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{contextParts[0]}</span>
              <span aria-hidden="true">&bull;</span>
              <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" />{contextParts[1]}</span>
              <span aria-hidden="true">&bull;</span>
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" />{contextParts[2]}</span>
            </div>
            {activeChips.length ? <div className="mt-3 flex flex-wrap gap-2">{activeChips.map((chip) => <span key={chip} className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">{chip}</span>)}</div> : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row xl:items-start">
            <div className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-900 ring-1 ring-blue-100">
              <div className="flex gap-2"><Info className="h-4 w-4 shrink-0 text-blue-700" />This report includes optional respondent names, comments and checklist answers captured from public feedback.</div>
            </div>
            {!readOnlyDemo ? (
              <button type="button" onClick={() => window.print()} className="no-print inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-qpms-300 bg-white px-5 py-2 text-sm font-black text-qpms-700 shadow-sm hover:bg-qpms-50" title="Opens the browser print dialog so you can save this report as PDF.">
                <Download className="h-4 w-4" />Export PDF
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="no-print mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex min-w-max">
          {tabs.map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`min-h-12 px-6 text-sm font-black ${activeTab === tab ? 'border-b-2 border-qpms-600 text-qpms-700' : 'text-slate-500 hover:text-slate-800'}`}>{tab}</button>
          ))}
        </div>
      </div>

      <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setFiltersOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"><Filter className="h-4 w-4" />Filters</button>
        <p className="text-xs font-semibold text-slate-500">Generated {formatIndiaDateTime(new Date().toISOString())}</p>
      </div>

      <div className="mt-4">
        <FilterPanel open={filtersOpen} filters={filters} setFilter={setFilter} clients={clients} hospitals={hospitals} blocks={blocks} floors={floors} locationOptions={locationOptions} onApply={loadDashboard} onClear={clearFilters} loading={loading} />
      </div>

      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div> : null}
      {loading ? <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700">Loading report data...</div> : null}

      <main className="mt-4 space-y-4">
        {activeTab === 'Overview' ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
            </section>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {cleanlinessKpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
            </section>
            {metrics.total === 0 ? <EmptyState title="No feedback for selected period" body="Report cards will populate when matching feedback submissions are available." /> : null}
            <section className="grid gap-4 xl:grid-cols-2">
              <RatingSummary distribution={distribution} trend={data?.dailyTrend || []} />
              <BlockPerformance blocks={blockRows} onOpenLocations={() => setActiveTab('Location-wise Report')} />
            </section>
            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.8fr_1fr]">
              <ReportCard title="Public Feedback Insights" subtitle="Names & Comments" action={<button type="button" onClick={() => setActiveTab('Comments & Names')} className="no-print text-xs font-black text-qpms-700">View all feedback</button>}>
                <CommentsTable rows={responseRows} limit={5} />
              </ReportCard>
              <ChecklistCard checklistRows={checklistRows} metrics={metrics} />
              <NeedsAttentionCard rows={responseRows} onOpen={() => { setFilter('needsAttention', 'true'); setActiveTab('Comments & Names'); }} />
            </section>
            <ReportCard
              title="Recent Public Complaints"
              subtitle="Latest Not Clean public reports linked to hospital tickets"
              action={<button type="button" onClick={() => setActiveTab('Tickets')} className="no-print text-xs font-black text-qpms-700">View all tickets</button>}
            >
              <DataTable rows={ticketRows.slice(0, 5)} columns={complaintColumns} emptyTitle="No public cleanliness complaints found for the selected filters." />
            </ReportCard>
          </>
        ) : null}

        {activeTab === 'Floor-wise Report' ? (
          <ReportCard title="Floor-wise Report" subtitle="Grouped by stable floor ID">
            <DataTable rows={floorRows} columns={floorColumns} />
          </ReportCard>
        ) : null}

        {activeTab === 'Location-wise Report' ? (
          <ReportCard title="Location-wise Report" subtitle="Grouped by stable location ID" action={<div className="no-print flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search className="h-4 w-4 text-slate-400" /><input value={locationSearch} onChange={(event) => { setLocationSearch(event.target.value); setLocationPage(1); }} placeholder="Search block, floor, location" className="w-56 bg-transparent text-sm font-semibold outline-none" /></div>}>
            <DataTable rows={pagedLocations} columns={locationColumns} />
            <div className="no-print mt-4 flex items-center justify-between text-xs font-black text-slate-500">
              <span>Showing {pagedLocations.length} of {filteredLocationRows.length}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setLocationPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40" disabled={locationPage === 1}>Previous</button>
                <button type="button" onClick={() => setLocationPage((page) => page + 1)} className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40" disabled={locationPage * locationPageSize >= filteredLocationRows.length}>Next</button>
              </div>
            </div>
          </ReportCard>
        ) : null}

        {activeTab === 'Comments & Names' ? (
          <ReportCard
            title="Comments & Names"
            subtitle="Full authenticated response list available from the current report payload"
            action={(
              <select
                value={responseFilter}
                onChange={(event) => setResponseFilter(event.target.value)}
                className="no-print rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
              >
                {responseFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
          >
            <CommentsTable rows={commentsTabRows} />
          </ReportCard>
        ) : null}

        {activeTab === 'Checklist Summary' ? (
          <ReportCard title="Checklist Summary" subtitle="Uses only known checklist answer values">
            {checklistRows.length ? (
              <DataTable rows={checklistRows} columns={[
                { key: 'item', label: 'Checklist Item' },
                { key: 'answered', label: 'Answered Count' },
                { key: 'positive', label: 'Positive Count' },
                { key: 'negative', label: 'Negative Count' },
                { key: 'percentage', label: 'Positive %', render: (row) => `${row.percentage}%` },
              ]} />
            ) : <EmptyState title="Checklist reporting will appear when checklist questions are enabled in the public feedback form." body="No production checklist percentages have been invented." />}
          </ReportCard>
        ) : null}

        {activeTab === 'Tickets' ? (
          <div className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Total Tickets" value={ticketSummary.total} helper="Public QR Feedback tickets" icon={MessageSquareText} tone="blue" />
              <KpiCard label="New" value={ticketSummary.newCount} helper="New complaint tickets" icon={AlertTriangle} tone="amber" />
              <KpiCard label="In Progress" value={ticketSummary.inProgress} helper="Operational work started" icon={RefreshCw} tone="blue" />
              <KpiCard label="Resolved" value={ticketSummary.resolved} helper="Resolved or closed tickets" icon={CheckCircle2} tone="green" />
              <KpiCard label="Assignment Required" value={ticketSummary.assignmentRequired} helper="Unassigned demo tickets" icon={ClipboardCheck} tone="violet" />
            </section>

            <ReportCard title="Planned Escalation Workflow" subtitle="Role-based escalation is under configuration for the client demo" action={<span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">Under Configuration</span>}>
              <div className="grid gap-3 md:grid-cols-5">
                {[
                  ['Supervisor', '15 minutes'],
                  ['Facility Manager', 'next 15 minutes'],
                  ['Zonal Head', 'next 15 minutes'],
                  ['Project Head', 'next 15 minutes'],
                  ['Hospital Dean', 'after 60 minutes'],
                ].map(([role, timing]) => (
                  <div key={role} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-black text-slate-800">{role}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{timing}</p>
                  </div>
                ))}
              </div>
            </ReportCard>

            <ReportCard
              title="Tickets"
              subtitle="Actual Public QR Feedback tickets from the authenticated report scope"
              action={(
                <div className="no-print flex flex-wrap items-center gap-2">
                  <select value={ticketFilters.status} onChange={(event) => setTicketFilters((current) => ({ ...current, status: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
                    {ticketStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={ticketFilters.assignment} onChange={(event) => setTicketFilters((current) => ({ ...current, assignment: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
                    {ticketAssignmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input value={ticketFilters.search} onChange={(event) => setTicketFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search ticket number" className="w-48 bg-transparent text-xs font-semibold outline-none" />
                  </label>
                </div>
              )}
            >
              <DataTable rows={filteredTicketRows} columns={ticketColumns} emptyTitle="No Public QR Feedback tickets found for the selected filters." />
            </ReportCard>
          </div>
        ) : null}

        <footer className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-900 ring-1 ring-blue-100">
          <div className="flex gap-2"><Info className="h-4 w-4 shrink-0" />Names are shown only when provided by respondents. Anonymous responses are included to ensure complete and unbiased insights.</div>
        </footer>
      </main>
    </div>
  );
}
