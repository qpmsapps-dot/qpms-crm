import { createElement, useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, ClockAlert, Handshake, PhoneCall, Plus, Target } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import { EmptyState, ErrorState, LeadTable, LoadingState, PreSalesBreadcrumbs, PreSalesStatCard, SectionHeader } from '../../components/preSales/PreSalesUi.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { getPreSalesDashboard } from '../../services/preSalesApi.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';

const cards = [
  { key: 'today_followups', label: 'Today Follow-ups', icon: CalendarClock, tone: 'blue', to: '/pre-sales/followups?filter=today' },
  { key: 'today_meetings', label: 'Today Meetings', icon: CalendarDays, tone: 'teal', to: '/pre-sales/meetings' },
  { key: 'callbacks_due', label: 'Callbacks Due', icon: PhoneCall, tone: 'amber', to: '/pre-sales/followups?filter=callbacks' },
  { key: 'overdue_followups', label: 'Overdue Follow-ups', icon: ClockAlert, tone: 'red', to: '/pre-sales/followups?filter=overdue' },
  { key: 'qualified_leads', label: 'Qualified Leads', icon: Target, tone: 'green', to: '/pre-sales/leads?stage=qualification' },
  { key: 'pending_handover', label: 'Pending Handover', icon: Handshake, tone: 'slate', to: '/pre-sales/handover' },
];

export default function PreSalesDashboard() {
  usePageTitle('Pre-Sales Dashboard');
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await getPreSalesDashboard();
      setState({ loading: false, error: '', data: response.dashboard });
    } catch (error) {
      setState({ loading: false, error: error.message, data: null });
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial remote load
  useEffect(() => { void load(); }, [load]);

  if (state.loading) return <LoadingState label="Loading Pre-Sales dashboard..." />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;

  const data = state.data;
  return (
    <div className="space-y-7">
      <PreSalesBreadcrumbs items={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Pre-Sales' }]} />
      <PageHeader
        title="Pre-Sales Dashboard"
        subtitle="Track calls, follow-ups, meetings, and handovers from one place."
        actions={<button type="button" onClick={() => navigate('/pre-sales/leads/new')} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white"><Plus className="h-4 w-4" /> Add Lead</button>}
      />

      <section aria-label="Pre-Sales summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card) => <PreSalesStatCard key={card.key} icon={card.icon} label={card.label} value={data.summary[card.key]} tone={card.tone} to={card.to} />)}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.55fr)]">
        <section className="enterprise-card p-5">
          <SectionHeader title="My Leads" action="View All Leads" to="/pre-sales/leads" />
          <LeadTable leads={data.my_leads} compact />
        </section>
        <section className="enterprise-card p-5">
          <SectionHeader title="Quick Actions" />
          <div className="grid gap-3">
            <Quick to="/pre-sales/leads/new" icon={Plus} label="Add Lead" description="Create a new Pre-Sales lead." />
            <Quick to="/pre-sales/leads" icon={PhoneCall} label="Add Call Update" description="Open a lead and record the call." />
            <Quick to="/pre-sales/leads" icon={CalendarDays} label="Schedule Meeting" description="Open a lead and plan a meeting." />
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <section className="enterprise-card p-5">
          <SectionHeader title="Today's Schedule" />
          {data.today_schedule.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Time</th><th className="pb-3">Type</th><th className="pb-3">Lead Name</th><th className="pb-3">Company</th><th className="pb-3">Purpose</th><th className="pb-3">Action</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{data.today_schedule.map((item) => <tr key={`${item.item_type}-${item.id}`}><td className="py-3 font-semibold">{new Date(item.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td className="py-3">{item.item_type}</td><td className="py-3 font-medium text-slate-800">{item.lead?.contact_name || item.lead?.primary_contact?.contact_person_name || item.lead?.client_name || 'Lead'}</td><td className="py-3 text-slate-600">{item.lead?.client_name || item.lead?.company_name || '—'}</td><td className="py-3 text-slate-500">{item.purpose || item.remarks || item.followup_type || '—'}</td><td className="py-3"><Link className="font-bold text-blue-700" to={`/pre-sales/leads/${item.lead_id}`}>Open Lead</Link></td></tr>)}</tbody>
              </table>
            </div>
          ) : <EmptyState title="No follow-ups or meetings today." />}
        </section>

        <section className="enterprise-card p-5">
          <SectionHeader title="Upcoming Follow-ups" action="View All" to="/pre-sales/followups" />
          {data.upcoming_followups.length ? <div className="space-y-3">{data.upcoming_followups.map((item) => <Link key={item.id} to={`/pre-sales/leads/${item.lead_id}`} className="block rounded-xl border border-slate-100 p-3 transition hover:border-blue-200 hover:bg-blue-50/40"><p className="font-semibold text-slate-900">{item.lead?.contact_name || item.lead?.client_name || 'Lead'}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(item.scheduled_at)} · {item.followup_type}</p></Link>)}</div> : <EmptyState title="No upcoming follow-ups." />}
        </section>
      </div>
    </div>
  );
}

function Quick({ to, icon, label, description }) {
  return <Link to={to} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300 hover:bg-blue-50/40"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">{createElement(icon, { className: 'h-4 w-4' })}</span><span><span className="block text-sm font-bold text-slate-800 group-hover:text-blue-700">{label}</span><span className="mt-0.5 block text-xs text-slate-500">{description}</span></span></Link>;
}
