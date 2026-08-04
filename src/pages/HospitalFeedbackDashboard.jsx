import { AlertTriangle, BarChart3, RefreshCw, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import PageHeader from '../components/PageHeader.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { getHospitalFeedbackDashboard, getHospitalFeedbackQrLocations } from '../services/api.js';

const LEGACY_CLIENT_KEY = '__legacy__';
const ratingOptions = ['', '5', '4', '3', '2', '1'];

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
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function clientOptions(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    const value = clientKey(row);
    const label = row.parentClientName || 'Legacy / Not Assigned';
    if (!seen.has(value)) seen.set(value, label);
  });
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 disabled:bg-slate-100 disabled:text-slate-400">
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function KpiCard({ title, value, helper, icon: Icon = Star, tone = 'slate' }) {
  const colors = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    qpms: 'bg-qpms-50 text-qpms-700',
  };
  return (
    <article className="enterprise-card-compact p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          {helper ? <p className="mt-1 text-xs font-semibold text-slate-500">{helper}</p> : null}
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${colors[tone] || colors.slate}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function performanceClass(value) {
  if (value === 'Excellent') return 'bg-emerald-100 text-emerald-700';
  if (value === 'Good') return 'bg-sky-100 text-sky-700';
  if (value === 'Critical') return 'bg-rose-100 text-rose-700';
  if (value === 'Needs Attention') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function PerformanceTable({ title, rows, columns }) {
  return (
    <section className="enterprise-card-compact overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-bold text-slate-950">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>{columns.map((column) => <th key={column.key} className="px-4 py-3">{column.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length ? rows.map((row) => (
              <tr key={row.key || row.locationId || row.floorId || row.blockId}>
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 font-semibold text-slate-800">
                    {column.render ? column.render(row) : row[column.key] ?? '-'}
                  </td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-sm font-bold text-slate-500">No feedback found for the selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function HospitalFeedbackDashboard() {
  usePageTitle('Soft Services Feedback Dashboard');
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ dateFrom: monthStart(), dateTo: today(), clientKey: '', hospitalId: '', blockId: '', floorId: '', locationId: '', rating: '', needsAttention: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  const locationOptions = useMemo(() => floorFiltered.map((row) => ({ value: row.id, label: row.locationName || row.locationCode || row.id })).sort((a, b) => a.label.localeCompare(b.label)), [floorFiltered]);

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
      setError(loadError.message || 'Unable to load feedback dashboard.');
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

  const summary = data?.summary || {};
  const blockColumns = [
    { key: 'blockName', label: 'Block' },
    { key: 'totalResponses', label: 'Total Responses' },
    { key: 'averageRating', label: 'Average Rating' },
    { key: 'fiveStar', label: '5 Star' },
    { key: 'fourStar', label: '4 Star' },
    { key: 'threeStar', label: '3 Star' },
    { key: 'twoStar', label: '2 Star' },
    { key: 'oneStar', label: '1 Star' },
    { key: 'needsAttention', label: 'Needs Attention' },
    { key: 'performance', label: 'Performance', render: (row) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${performanceClass(row.performance)}`}>{row.performance}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Soft Services Feedback Dashboard" description="Monitor public feedback ratings by client, hospital, block, floor and location." />

      <section className="enterprise-card-compact p-5">
        <div className="grid gap-3 xl:grid-cols-[repeat(9,minmax(120px,1fr))_auto]">
          <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Date From</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold" /></label>
          <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Date To</span><input type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold" /></label>
          <SelectField label="Client" value={filters.clientKey} onChange={(value) => setFilter('clientKey', value)} options={clients} />
          <SelectField label="Hospital" value={filters.hospitalId} onChange={(value) => setFilter('hospitalId', value)} options={hospitals} disabled={!filters.clientKey} />
          <SelectField label="Block" value={filters.blockId} onChange={(value) => setFilter('blockId', value)} options={blocks} disabled={!filters.hospitalId} />
          <SelectField label="Floor" value={filters.floorId} onChange={(value) => setFilter('floorId', value)} options={floors} disabled={!filters.blockId} />
          <SelectField label="Location" value={filters.locationId} onChange={(value) => setFilter('locationId', value)} options={locationOptions} disabled={!filters.floorId} />
          <SelectField label="Rating" value={filters.rating} onChange={(value) => setFilter('rating', value)} options={ratingOptions.filter(Boolean).map((value) => ({ value, label: `${value} Star` }))} />
          <SelectField label="Needs Attention" value={filters.needsAttention} onChange={(value) => setFilter('needsAttention', value)} options={[{ value: 'true', label: 'Needs Attention' }, { value: 'false', label: 'Normal' }]} />
          <button type="button" onClick={loadDashboard} disabled={loading} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Total Feedback" value={summary.totalResponses || 0} icon={BarChart3} tone="qpms" />
        <KpiCard title="Average Rating" value={Number(summary.averageRating || 0).toFixed(2)} icon={Star} tone="emerald" />
        <KpiCard title="Five-Star Percentage" value={`${summary.fiveStarPercentage || 0}%`} helper={`${summary.fiveStarCount || 0} responses`} icon={Star} tone="emerald" />
        <KpiCard title="Below-4 Feedback" value={summary.belowFourCount || 0} helper="Needs Attention" icon={AlertTriangle} tone="amber" />
        <KpiCard title="Best Performing Block" value={summary.bestBlock?.blockName || 'No Data'} helper={summary.bestBlock ? `${summary.bestBlock.averageRating} average` : ''} icon={Star} tone="emerald" />
        <KpiCard title="Lowest Performing Block" value={summary.lowestBlock?.blockName || 'No Data'} helper={summary.lowestBlock ? `${summary.lowestBlock.averageRating} average` : ''} icon={AlertTriangle} tone="rose" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="enterprise-card-compact p-5">
          <h2 className="text-base font-bold text-slate-950">Block Comparison</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.blockPerformance || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="blockName" />
                <YAxis yAxisId="left" domain={[0, 5]} />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Bar yAxisId="left" dataKey="averageRating" fill="#047857" name="Average rating" />
                <Bar yAxisId="right" dataKey="totalResponses" fill="#2563eb" name="Responses" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="enterprise-card-compact p-5">
          <h2 className="text-base font-bold text-slate-950">Daily Rating Trend</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.dailyTrend || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 5]} />
                <Tooltip />
                <Line type="monotone" dataKey="averageRating" stroke="#047857" strokeWidth={3} name="Average rating" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <PerformanceTable title="Block-wise Performance" rows={data?.blockPerformance || []} columns={blockColumns} />
      <PerformanceTable title="Floor Drill-down" rows={data?.floorPerformance || []} columns={[
        { key: 'blockName', label: 'Block' },
        { key: 'floorName', label: 'Floor' },
        { key: 'totalResponses', label: 'Responses' },
        { key: 'averageRating', label: 'Average' },
        { key: 'needsAttention', label: 'Needs Attention' },
        { key: 'performance', label: 'Performance', render: (row) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${performanceClass(row.performance)}`}>{row.performance}</span> },
      ]} />
      <PerformanceTable title="Location Drill-down" rows={data?.locationPerformance || []} columns={[
        { key: 'blockName', label: 'Block' },
        { key: 'floorName', label: 'Floor' },
        { key: 'locationName', label: 'Location' },
        { key: 'totalResponses', label: 'Responses' },
        { key: 'averageRating', label: 'Average' },
        { key: 'needsAttention', label: 'Needs Attention' },
        { key: 'performance', label: 'Performance', render: (row) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${performanceClass(row.performance)}`}>{row.performance}</span> },
      ]} />
      <PerformanceTable title="Recent Needs Attention" rows={data?.recentNeedsAttention || []} columns={[
        { key: 'submittedAt', label: 'Submitted' },
        { key: 'parentClientName', label: 'Client' },
        { key: 'hospitalName', label: 'Hospital' },
        { key: 'blockName', label: 'Block' },
        { key: 'floorName', label: 'Floor' },
        { key: 'locationName', label: 'Location' },
        { key: 'rating', label: 'Rating' },
        { key: 'language', label: 'Language' },
        { key: 'comments', label: 'Comment' },
      ]} />
    </div>
  );
}
