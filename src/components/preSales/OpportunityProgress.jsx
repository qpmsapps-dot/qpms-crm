import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import { getOpportunityProgress } from '../../services/preSalesApi.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';
import { EmptyState, ErrorState, LoadingState } from './PreSalesUi.jsx';

const label = (value) => value ? String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—';

export default function OpportunityProgress({ leadId }) {
  const [state, setState] = useState({ loading: true, error: '', progress: null });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await getOpportunityProgress(leadId);
      setState({ loading: false, error: '', progress: response.progress });
    } catch (error) {
      setState({ loading: false, error: error.message, progress: null });
    }
  }, [leadId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated API load
  useEffect(() => { void load(); }, [load]);

  if (state.loading) return <LoadingState label="Loading opportunity progress..." />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;
  const progress = state.progress;
  return <div className="space-y-5">
    <section className="enterprise-card p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Current Stage" value={progress.current_stage_label} />
        <Summary label="Status" value={progress.current_status} />
        <Summary label="Responsible Department" value={progress.responsible_department} />
        <Summary label="Responsible User" value={progress.responsible_user} />
        <Summary label="Last Updated" value={formatDateTime(progress.last_updated)} />
        <Summary label="Next Stage" value={label(progress.next_stage)} />
        <Summary label="Proposal Status" value={progress.proposal_status} />
        <Summary label="Final Outcome" value={progress.final_outcome === 'Converted' ? 'Success / Converted' : progress.final_outcome} />
      </div>
    </section>
    <section className="enterprise-card p-5">
      <h2 className="text-lg font-bold text-slate-950">Opportunity Timeline</h2>
      {progress.timeline?.length ? <ol className="mt-5 space-y-4">{progress.timeline.map((item, index) => <li key={item.id} className="grid grid-cols-[32px_1fr] gap-3"><span className="mt-0.5 grid h-8 w-8 place-items-center rounded-full bg-blue-50 text-blue-700">{index === progress.timeline.length - 1 ? <Clock3 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</span><div className="rounded-xl border border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-slate-900">{item.stage_label}</p><p className="text-xs font-semibold text-slate-500">{formatDateTime(item.occurred_at)}</p></div><p className="mt-1 text-sm text-slate-600">{item.summary}</p><div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500"><span>{item.status || 'Recorded'}</span>{item.responsible_department ? <span>• {item.responsible_department}</span> : null}{item.responsible_user ? <span>• {item.responsible_user}</span> : null}</div></div></li>)}</ol> : <EmptyState title="No opportunity progress recorded yet." />}
    </section>
  </div>;
}

function Summary({ label: title, value }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value || '—'}</p></div>;
}
