import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState, PreSalesBreadcrumbs } from '../../components/preSales/PreSalesUi.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { getFollowups, getPreSalesDashboard, getPreSalesLeads } from '../../services/preSalesApi.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';

const queueCopy = {
  today: { title: 'Today Follow-ups', subtitle: 'Follow-ups scheduled for today.' },
  callbacks: { title: 'Callbacks Due', subtitle: 'Callback actions due today.' },
  overdue: { title: 'Overdue Follow-ups', subtitle: 'Pending actions that need immediate attention.' },
  pending: { title: 'Follow-up Queue', subtitle: 'Review pending follow-up actions.' },
};

export default function PreSalesWorkQueue() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const routeMode = pathname.endsWith('/meetings') ? 'meetings' : pathname.endsWith('/handover') ? 'handover' : pathname.endsWith('/reports') ? 'reports' : 'followups';
  const requestedFilter = searchParams.get('filter') || 'pending';
  const filter = ['today', 'callbacks', 'overdue', 'pending'].includes(requestedFilter) ? requestedFilter : 'pending';
  const title = routeMode === 'meetings' ? 'Today Meetings' : routeMode === 'handover' ? 'Handover to BD' : routeMode === 'reports' ? 'Pre-Sales Reports' : queueCopy[filter].title;
  const subtitle = routeMode === 'meetings' ? "Today's scheduled Pre-Sales meetings." : routeMode === 'handover' ? 'Qualified leads waiting for Business Development handover.' : routeMode === 'reports' ? 'Pre-Sales operational summary and handover status.' : queueCopy[filter].subtitle;
  usePageTitle(title);
  const [state, setState] = useState({ loading: true, error: '', items: [], summary: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      if (routeMode === 'followups') {
        const apiFilter = filter === 'callbacks' ? 'today' : filter;
        const response = await getFollowups({ filter: apiFilter });
        const items = filter === 'callbacks' ? response.items.filter((item) => item.followup_type === 'call_back') : response.items;
        setState({ loading: false, error: '', items, summary: null });
        return;
      }
      if (routeMode === 'handover') {
        const [dashboardResponse, leadsResponse] = await Promise.all([getPreSalesDashboard(), getPreSalesLeads({ stage: 'pending_bd_handover', page: 1, page_size: 50 })]);
        setState({ loading: false, error: '', items: leadsResponse.items || [], summary: dashboardResponse.dashboard.summary });
        return;
      }
      const response = await getPreSalesDashboard();
      const items = routeMode === 'meetings' ? response.dashboard.today_schedule.filter((item) => item.item_type === 'Meeting') : [];
      setState({ loading: false, error: '', items, summary: response.dashboard.summary });
    } catch (error) {
      setState({ loading: false, error: error.message, items: [], summary: null });
    }
  }, [filter, routeMode]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- route-backed queue load
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <PreSalesBreadcrumbs items={[{ label: 'Pre-Sales', to: '/pre-sales' }, { label: title }]} />
      <PageHeader title={title} subtitle={subtitle} />
      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : state.items.length ? <section className="enterprise-card divide-y divide-slate-100 p-5">{state.items.map((item) => {
        const lead = item.lead || item;
        const leadId = item.lead_id || item.id;
        return <div key={`${routeMode}-${item.id}`} className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"><div><p className="font-semibold text-slate-900">{lead.contact_name || lead.client_name || lead.company_name || item.followup_type || item.item_type}</p><p className="mt-1 text-sm text-slate-500">{item.scheduled_at ? `${formatDateTime(item.scheduled_at)} · ` : ''}{item.remarks || item.purpose || item.next_action || item.pre_sales_stage || item.status}</p></div><Link to={`/pre-sales/leads/${leadId}`} className="text-sm font-bold text-blue-700">Open Lead →</Link></div>;
      })}</section> : <EmptyState title={routeMode === 'handover' && state.summary?.pending_handover ? `${state.summary.pending_handover} handover(s) are pending acceptance.` : `No ${title.toLowerCase()} to show.`} description={routeMode === 'handover' ? 'Qualified leads will appear here when they reach the handover stage.' : undefined} />}
    </div>
  );
}
