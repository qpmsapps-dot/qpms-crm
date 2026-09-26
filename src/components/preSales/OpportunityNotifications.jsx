import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOpportunityNotifications } from '../../services/preSalesApi.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';

export default function OpportunityNotifications({ limit = 5 }) {
  const [state, setState] = useState({ loading: true, items: [] });
  const load = useCallback(async () => {
    try {
      const response = await getOpportunityNotifications(limit);
      setState({ loading: false, items: response.items || [] });
    } catch {
      // Notifications are supplementary: a notification read failure must not
      // hide or block the authoritative opportunity workflow.
      setState({ loading: false, items: [] });
    }
  }, [limit]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated API load
  useEffect(() => { void load(); }, [load]);
  if (state.loading || !state.items.length) return null;
  return <section className="enterprise-card p-5">
    <h2 className="text-lg font-bold text-slate-950">Opportunity Updates</h2>
    <div className="mt-4 space-y-3">
      {state.items.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-3">
        <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-bold text-slate-900">{item.title}</p><p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p></div>
        {item.message ? <p className="mt-1 text-sm text-slate-600">{item.message}</p> : null}
        {item.action_url ? <Link to={item.action_url} className="mt-2 inline-block text-sm font-bold text-blue-700">Open opportunity</Link> : null}
      </div>)}
    </div>
  </section>;
}
