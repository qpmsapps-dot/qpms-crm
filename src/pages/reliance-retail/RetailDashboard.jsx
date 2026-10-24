import { useEffect, useMemo, useState } from 'react';
import { MapPin, Store, Users, Wrench } from 'lucide-react';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { relianceRetailApi } from '../../services/relianceRetailApi.js';

export default function RetailDashboard() {
  usePageTitle('Reliance Retail Dashboard');
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [zones, setZones] = useState([]); const [allStores, setAllStores] = useState([]);
  const [filters, setFilters] = useState({ month: new Date().toISOString().slice(0, 7), state: '', zone_id: '', store_id: '' });
  useEffect(() => { let live = true; setError(''); relianceRetailApi.dashboard(filters).then((r) => { if (!live) return; setData(r.dashboard); if (!filters.state && !filters.zone_id && !filters.store_id) { setZones(r.dashboard.zones || []); setAllStores(r.dashboard.stores || []); } }).catch((e) => live && setError(e.response?.data?.message || e.message)); return () => { live = false; }; }, [filters]);
  const states = useMemo(() => [...new Set(allStores.map((row) => row.state).filter(Boolean))].sort(), [allStores]);
  const stores = useMemo(() => allStores.filter((row) => (!filters.state || row.state === filters.state) && (!filters.zone_id || row.zone_id === filters.zone_id)), [allStores, filters.state, filters.zone_id]);
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value, ...(key === 'state' || key === 'zone_id' ? { store_id: '' } : {}) }));
  const cards = data ? [
    ['Total Stores', data.total_stores, Store], ['Active / Inactive', `${data.active_stores} / ${data.inactive_stores}`, Store],
    ['Active Zones', data.active_zones, MapPin], ['Assigned FOs', data.assigned_fo_count, Users],
    ['GPS Ready / Pending', `${data.gps_ready} / ${data.location_pending}`, MapPin],
    ['Deep Cleaning', data.deep_cleaning_submissions, Wrench], ['Training Sessions', data.training_sessions, Users],
    ['Fault Tracker', data.fault_tracker ?? 'Data Not Available', Wrench],
  ] : [];
  return <div className="space-y-6"><div><p className="text-sm font-bold text-qpms-600">Reliance Retail</p><h1 className="text-2xl font-black">Consolidated Dashboard</h1><p className="text-sm text-slate-500">Actual stored data only. No polling or estimated metrics.</p></div>
    <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-bold text-slate-600">Month / Year<input type="month" value={filters.month} onChange={(e) => update('month', e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">State<select value={filters.state} onChange={(e) => update('state', e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"><option value="">All States</option>{states.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">Zone<select value={filters.zone_id} onChange={(e) => update('zone_id', e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"><option value="">All Zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.zone_name}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">Store<select value={filters.store_id} onChange={(e) => update('store_id', e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"><option value="">All Stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.store_code} · {store.store_name}</option>)}</select></label>
    </div>
    {error ? <div className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div> : null}
    {!data && !error ? <div className="rounded-2xl bg-white p-8">Loading dashboard…</div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-2xl border bg-white p-5 shadow-sm"><Icon className="h-5 w-5 text-qpms-600"/><p className="mt-4 text-xs font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>)}</div>}
  </div>;
}
