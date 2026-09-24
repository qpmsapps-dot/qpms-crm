import { createElement } from 'react';
import { AlertCircle, ArrowRight, ChevronRight, Inbox, LoaderCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { preSalesStageLabel } from '../../../shared/preSalesConstants.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';

export function LoadingState({ label = 'Loading...' }) {
  return <div className="enterprise-card flex min-h-40 items-center justify-center gap-3 p-6 text-sm font-semibold text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />{label}</div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="enterprise-card flex min-h-40 flex-col items-center justify-center gap-3 border-rose-200 p-6 text-center"><AlertCircle className="h-7 w-7 text-rose-500" /><p className="text-sm font-semibold text-rose-700">{message}</p>{onRetry ? <button type="button" onClick={onRetry} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Retry</button> : null}</div>;
}

export function EmptyState({ title, description }) {
  return <div className="enterprise-card flex min-h-40 flex-col items-center justify-center p-6 text-center"><Inbox className="h-8 w-8 text-slate-300" /><p className="mt-3 font-semibold text-slate-800">{title}</p>{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}</div>;
}

export function PreSalesBreadcrumbs({ items = [] }) {
  return <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-500">{items.map((item, index) => <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">{index ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" /> : null}{item.to ? <Link to={item.to} className="transition hover:text-blue-700">{item.label}</Link> : <span className="text-slate-800">{item.label}</span>}</span>)}</nav>;
}

export function PreSalesStatCard({ icon, label, value, tone = 'blue', to, description }) {
  const tones = { blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-rose-50 text-rose-700', teal: 'bg-teal-50 text-teal-700', slate: 'bg-slate-100 text-slate-700' };
  const content = <><div className="flex items-start justify-between gap-3"><div className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone] || tones.blue}`}>{createElement(icon, { className: 'h-5 w-5' })}</div>{to ? <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /> : null}</div><p className="mt-5 text-3xl font-bold text-slate-950">{value ?? 0}</p><p className="mt-1 text-sm font-medium text-slate-500">{label}</p>{description ? <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p> : null}</>;
  return to ? <Link to={to} className="enterprise-card group block p-5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg">{content}</Link> : <article className="enterprise-card p-5">{content}</article>;
}

export function LeadStageBadge({ value }) {
  const normalized = String(value || 'new_lead');
  const tone = normalized.includes('invalid') ? 'bg-rose-50 text-rose-700' : normalized.includes('handover') || normalized.includes('accepted') ? 'bg-emerald-50 text-emerald-700' : normalized.includes('meeting') ? 'bg-teal-50 text-teal-700' : normalized.includes('follow') ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{preSalesStageLabel(normalized)}</span>;
}

export function LeadPriorityBadge({ value }) {
  const tone = value === 'High' ? 'bg-rose-50 text-rose-700' : value === 'Low' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{value || 'Medium'}</span>;
}

export function LeadTable({ leads = [], compact = false }) {
  const navigate = useNavigate();
  if (!leads.length) return <EmptyState title="No leads assigned." description="Leads in your permitted scope will appear here." />;
  const openLead = (leadId) => navigate(`/pre-sales/leads/${leadId}`);
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Next Action</th>{compact ? null : <><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Last Updated</th></>}<th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{leads.map((lead) => <tr key={lead.id} role="link" tabIndex={0} onClick={() => openLead(lead.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLead(lead.id); } }} className="cursor-pointer hover:bg-slate-50 focus:bg-blue-50 focus:outline-none"><td className="px-4 py-4 font-semibold text-slate-900">{lead.contact_name || lead.primary_contact?.contact_person_name || lead.client_name || 'Unnamed lead'}</td><td className="px-4 py-4 text-slate-600">{lead.client_name || lead.company_name || '—'}</td><td className="px-4 py-4"><LeadStageBadge value={lead.pre_sales_stage} /></td><td className="px-4 py-4 text-slate-600">{lead.next_action || '—'}</td>{compact ? null : <><td className="px-4 py-4"><LeadPriorityBadge value={lead.lead_priority} /></td><td className="px-4 py-4 text-slate-600">{lead.owner_name || 'Unassigned'}</td><td className="px-4 py-4 text-slate-500">{formatDateTime(lead.last_update)}</td></>}<td className="px-4 py-4"><Link to={`/pre-sales/leads/${lead.id}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-900">Open Lead <ArrowRight className="h-4 w-4" /></Link></td></tr>)}</tbody></table></div>;
}

export function SectionHeader({ title, action, to }) {
  return <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-950">{title}</h2>{action && to ? <Link to={to} className="inline-flex items-center gap-1 text-sm font-bold text-blue-700">{action}<ArrowRight className="h-4 w-4" /></Link> : null}</div>;
}
