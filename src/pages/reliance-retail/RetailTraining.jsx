import { useEffect, useState } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { authenticatedApiRequest } from '../../services/api.js';

export default function RetailTraining() {
  usePageTitle('Reliance Retail Technical Training');
  const [sessions, setSessions] = useState([]); const [error, setError] = useState('');
  useEffect(() => { let live = true; authenticatedApiRequest({ url: '/api/training/sessions', params: { limit: 100 } }).then((r) => live && setSessions(r.data?.sessions || r.data?.data || [])).catch((e) => live && setError(e.response?.data?.message || e.message)); return () => { live = false; }; }, []);
  return <div className="space-y-5"><div><p className="text-sm font-bold text-qpms-600">Reliance Retail</p><h1 className="text-2xl font-black">Technical Training</h1><p className="text-sm text-slate-500">Existing Training records; creation and mobile workflow are unchanged.</p></div>{error ? <div className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div> : null}<div className="overflow-x-auto rounded-2xl border bg-white"><table className="min-w-full text-sm"><thead><tr>{['Date','Store','Trainer','Status','Attendees','Topics'].map((h) => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{sessions.map((s) => <tr key={s.id} className="border-t"><td className="p-3">{s.training_date || '--'}</td><td className="p-3">{s.store?.store_name || s.store_code_snapshot || '--'}</td><td className="p-3">{s.trainer_name || '--'}</td><td className="p-3">{s.status}</td><td className="p-3">{s.attendee_count ?? '--'}</td><td className="p-3">{s.topic_count ?? '--'}</td></tr>)}</tbody></table>{!sessions.length && !error ? <p className="p-8 text-center text-slate-500">No stored Training sessions found.</p> : null}</div></div>;
}
