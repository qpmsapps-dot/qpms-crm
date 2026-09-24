import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import { ErrorState, LeadTable, LoadingState, PreSalesBreadcrumbs } from '../../components/preSales/PreSalesUi.jsx';
import { PRE_SALES_STAGE_LABELS } from '../../../shared/preSalesConstants.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { getPreSalesLeads, getPreSalesOwners } from '../../services/preSalesApi.js';

export default function PreSalesLeads() {
  usePageTitle('Leads');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = useMemo(() => ({
    search: searchParams.get('search') || '',
    stage: searchParams.get('stage') || '',
    owner: searchParams.get('owner') || '',
    priority: searchParams.get('priority') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
    page: Number(searchParams.get('page') || 1),
    page_size: 20,
    sort_by: 'updated_at',
    sort_direction: 'desc',
  }), [searchParams]);
  const [state, setState] = useState({ loading: true, error: '', result: null });
  const [owners, setOwners] = useState([]);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      setState({ loading: false, error: '', result: await getPreSalesLeads(params) });
    } catch (error) {
      setState({ loading: false, error: error.message, result: null });
    }
  }, [params]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- query-backed list load
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { getPreSalesOwners().then((response) => setOwners(response.items || [])).catch(() => setOwners([])); }, []);

  const update = (key, value) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.set('page', '1');
    return next;
  });
  const clear = () => setSearchParams(new URLSearchParams());
  const activeFilterCount = ['stage', 'owner', 'priority', 'date_from', 'date_to'].filter((key) => params[key]).length;
  const result = state.result;

  return (
    <div className="space-y-6">
      <PreSalesBreadcrumbs items={[{ label: 'Pre-Sales', to: '/pre-sales' }, { label: 'Leads' }]} />
      <PageHeader title="Leads" subtitle="Manage and follow active Pre-Sales opportunities." actions={<button type="button" onClick={() => navigate('/pre-sales/leads/new')} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white"><Plus className="h-4 w-4" /> Add Lead</button>} />

      <section className="enterprise-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input aria-label="Search leads" value={params.search} onChange={(event) => update('search', event.target.value)} placeholder="Search leads..." className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-300" /></label>
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700"><SlidersHorizontal className="h-4 w-4" /> Filters{activeFilterCount ? <span className="rounded-full bg-blue-700 px-2 py-0.5 text-xs text-white">{activeFilterCount}</span> : null}</button>
          <button type="button" onClick={clear} disabled={!searchParams.toString()} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 disabled:opacity-40"><X className="h-4 w-4" /> Clear</button>
        </div>
        {filtersOpen ? <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-5"><select aria-label="Stage" value={params.stage} onChange={(event) => update('stage', event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">All stages</option>{Object.entries(PRE_SALES_STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Owner" value={params.owner} onChange={(event) => update('owner', event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">All owners</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}</select><select aria-label="Priority" value={params.priority} onChange={(event) => update('priority', event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select><input aria-label="From date" type="date" value={params.date_from} onChange={(event) => update('date_from', event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /><input aria-label="To date" type="date" value={params.date_to} onChange={(event) => update('date_to', event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></div> : null}
      </section>

      {state.loading ? <LoadingState label="Loading leads..." /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : <><p className="text-sm font-semibold text-slate-500">{result.total} {result.total === 1 ? 'lead' : 'leads'} found</p><LeadTable leads={result.items} /><div className="flex items-center justify-between"><p className="text-sm text-slate-500">Page {result.page}</p><div className="flex gap-2"><button type="button" disabled={result.page <= 1} onClick={() => update('page', String(result.page - 1))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold disabled:opacity-40">Previous</button><button type="button" disabled={result.page * result.page_size >= result.total} onClick={() => update('page', String(result.page + 1))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold disabled:opacity-40">Next</button></div></div></>}
    </div>
  );
}
