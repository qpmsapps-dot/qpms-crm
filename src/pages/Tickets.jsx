import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Filter,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Tag,
  TicketCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { getHospitalTicketDetail, getHospitalTicketSummary, getHospitalTickets } from '../services/hospitalTicketsApi.js';
import { usePageTitle } from '../hooks/usePageTitle.js';

const statusStyles = {
  open: 'bg-blue-50 text-blue-700 ring-blue-200',
  awaiting_supervisor_acceptance: 'bg-amber-50 text-amber-700 ring-amber-200',
  assigned: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  accepted: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  in_progress: 'bg-sky-50 text-sky-700 ring-sky-200',
  escalated_operations_executive: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  escalated_facility_manager: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  escalated_project_head: 'bg-rose-50 text-rose-700 ring-rose-200',
  resolved_awaiting_confirmation: 'bg-amber-50 text-amber-700 ring-amber-200',
  reopened: 'bg-rose-50 text-rose-700 ring-rose-200',
  closed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const priorityStyles = {
  critical: 'bg-rose-50 text-rose-700 ring-rose-200',
  high: 'bg-orange-50 text-orange-700 ring-orange-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const kpiMeta = [
  ['total', 'Total', TicketCheck, 'blue'],
  ['open', 'Open', FolderOpen, 'orange'],
  ['awaiting_supervisor_acceptance', 'Awaiting Supervisor', Clock3, 'orange'],
  ['assigned', 'Assigned', CircleUserRound, 'purple'],
  ['in_progress', 'In Progress', Clock3, 'blue'],
  ['escalated', 'Escalated', AlertTriangle, 'orange'],
  ['resolved', 'Resolved', CheckCircle2, 'green'],
  ['closed', 'Closed', CheckCircle2, 'green'],
  ['unassigned', 'Unassigned', ShieldAlert, 'orange'],
  ['overdue', 'Overdue', AlertTriangle, 'red'],
  ['on_duty_supervisors', 'On-Duty Supervisors', UserRound, 'green'],
  ['reopened', 'Reopened', RefreshCw, 'red'],
];

const statusOptions = [
  ['all', 'All Statuses'],
  ['open', 'Open'],
  ['awaiting_supervisor_acceptance', 'Awaiting Supervisor'],
  ['assigned', 'Assigned'],
  ['accepted', 'Accepted'],
  ['in_progress', 'In Progress'],
  ['escalated_operations_executive', 'Escalated - Operations'],
  ['escalated_facility_manager', 'Escalated - Facility'],
  ['escalated_project_head', 'Escalated - Project Head'],
  ['resolved_awaiting_confirmation', 'Awaiting Client Confirmation'],
  ['reopened', 'Reopened'],
  ['closed', 'Closed'],
  ['cancelled', 'Cancelled'],
];

const priorityOptions = [
  ['all', 'All Priorities'],
  ['critical', 'Critical'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
];

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusLabel(value) {
  if (value === 'resolved_awaiting_confirmation') return 'Awaiting Client Confirmation';
  if (value === 'awaiting_supervisor_acceptance') return 'Waiting for QPMS Response';
  if (value === 'escalated_operations_executive') return 'Escalated to Operations';
  if (value === 'escalated_facility_manager') return 'Escalated to Facility Manager';
  if (value === 'escalated_project_head') return 'Escalated to Project Head';
  return titleCase(value);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }).format(date);
}

function relativeRefresh(value) {
  if (!value) return 'Not refreshed yet';
  return `Last refreshed ${formatDate(value)}`;
}

function locationText(ticket) {
  const parts = ticket?.location_path?.length
    ? ticket.location_path
    : [ticket?.block?.name, ticket?.floor_name, ticket?.department_name, ticket?.location_text, ticket?.landmark];
  return parts.filter(Boolean).join(' / ') || '-';
}

function shortLocation(ticket) {
  return [ticket?.block?.name, ticket?.floor_name, ticket?.location_text || ticket?.department_name, ticket?.landmark]
    .filter(Boolean)
    .slice(0, 3)
    .join(' / ') || '-';
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${className}`}>{children}</span>;
}

function StatCard({ item }) {
  const [, label, Icon, tone] = item;
  const toneStyle = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    orange: 'bg-orange-50 text-orange-700 ring-orange-200',
    purple: 'bg-violet-50 text-violet-700 ring-violet-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
  }[tone];
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{item.value ?? 0}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-2xl ring-1 ring-inset ${toneStyle}`}><Icon className="h-5 w-5" /></span>
      </div>
    </article>
  );
}

function DetailCard({ title, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-xs font-extrabold text-slate-800">{title}</h3></div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ErrorPanel({ message, onRetry, denied = false }) {
  const Icon = denied ? ShieldAlert : AlertTriangle;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
      <Icon className={`mx-auto h-10 w-10 ${denied ? 'text-amber-500' : 'text-rose-500'}`} />
      <p className="mt-3 text-sm font-extrabold text-slate-800">{denied ? 'Permission Required' : 'Unable to Load Tickets'}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-slate-500">{message}</p>
      {onRetry ? <button onClick={onRetry} className="focus-ring mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white"><RefreshCw className="h-4 w-4" />Retry</button> : null}
    </div>
  );
}

function LoadingPanel({ label = 'Loading hospital tickets...' }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
        <p className="mt-3 text-sm font-bold text-slate-600">{label}</p>
      </div>
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-semibold leading-5 text-blue-700">
      Web monitoring is read-only in this phase. Ticket actions remain in the approved mobile workflows.
    </div>
  );
}

function AttachmentGrid({ attachments = [] }) {
  if (!attachments.length) {
    return <p className="text-xs font-semibold text-slate-500">No attachments uploaded.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <AttachmentPreview attachment={attachment} />
          <p className="mt-2 truncate text-[10px] font-bold text-slate-700" title={attachment.original_filename}>{attachment.original_filename}</p>
          <p className="text-[9px] text-slate-400">{titleCase(attachment.attachment_type)}</p>
        </div>
      ))}
    </div>
  );
}

function AttachmentPreview({ attachment }) {
  const [failed, setFailed] = useState(false);
  if (attachment.signed_url && !failed) {
    return <img src={attachment.signed_url} alt={attachment.original_filename || 'Ticket attachment'} onError={() => setFailed(true)} className="h-16 w-full rounded-md bg-white object-cover" loading="lazy" />;
  }
  return <div className="grid h-16 place-items-center rounded-md bg-white text-slate-400"><ImageIcon className="h-6 w-6" /></div>;
}

function ProgressSteps({ ticket }) {
  const steps = [
    ['Raised', ticket?.raised_at],
    ['Assigned', ticket?.assigned_at],
    ['Accepted', ticket?.accepted_at],
    ['Work Started', ticket?.work_started_at],
    ['Resolved', ticket?.resolved_at],
    ['Closed', ticket?.closed_at],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {steps.map(([label, time], index) => {
        const reached = Boolean(time) || index === 0;
        return (
          <div key={label} className={`rounded-xl border px-3 py-3 ${reached ? 'border-blue-100 bg-blue-50/70' : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs font-extrabold ${reached ? 'text-blue-700' : 'text-slate-400'}`}>{label}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{formatDate(time || (index === 0 ? ticket?.raised_at : null))}</p>
          </div>
        );
      })}
    </div>
  );
}

function TicketDetailRoute({ ticketId, onBack }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDetail(await getHospitalTicketDetail(ticketId));
    } catch (loadError) {
      setError(friendlyError(loadError));
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadDetail();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadDetail]);

  const data = detail?.ticket;
  const attachments = detail?.attachments || [];
  const beforeImages = attachments.filter((row) => row.attachment_type === 'complaint_photo');
  const afterImages = attachments.filter((row) => row.attachment_type === 'completion_photo');

  if (loading) return <LoadingPanel label="Loading ticket details..." />;
  if (error) return <ErrorPanel message={error} onRetry={loadDetail} />;
  if (!data) return <ErrorPanel message="Ticket details were not available." onRetry={loadDetail} />;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-700">
        <ChevronLeft className="h-4 w-4" />Back to Tickets
      </button>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">{data.title || `${data.category?.name || 'Hospital'} Complaint`}</h1>
            <p className="mt-1 text-sm font-extrabold text-blue-700">{data.ticket_no}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill className={statusStyles[data.status_code] || statusStyles.open}>{statusLabel(data.status_code)}</Pill>
            <Pill className={priorityStyles[data.priority] || priorityStyles.medium}>{titleCase(data.priority)} Priority</Pill>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-4">
          <DetailCard title="Complaint Overview">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Client', data.client?.name, CircleUserRound],
                ['Location', locationText(data), MapPin],
                ['Category', data.category?.name, Tag],
                ['Created On', formatDate(data.raised_at), Clock3],
                ['Raised By', data.raised_by?.name, UserRound],
                ['Assigned To', data.current_assignee?.display_name || 'Unassigned', UserRound],
                ['Status', statusLabel(data.status_code), CheckCircle2],
                ['Priority', titleCase(data.priority), AlertTriangle],
              ].filter(([, value]) => value && value !== '-').map(([label, value, MetaIcon]) => (
                <div key={label} className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{createElement(MetaIcon, { className: 'h-3.5 w-3.5' })}{label}</p>
                  <p className="mt-1 break-words text-xs font-bold leading-5 text-slate-800">{value}</p>
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Complaint Description">
            <p className="text-sm leading-6 text-slate-700">{data.description || data.description_preview || '-'}</p>
          </DetailCard>

          <DetailCard title="Complaint / Before Image">
            <AttachmentGrid attachments={beforeImages} />
          </DetailCard>

          <DetailCard title="Ticket Progress">
            <ProgressSteps ticket={data} />
          </DetailCard>
        </main>

        <aside className="space-y-4">
          <DetailCard title="Resolution">
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              <p><span className="font-bold text-slate-800">Remarks:</span> {data.resolution_remarks || 'Not resolved yet.'}</p>
              <p><span className="font-bold text-slate-800">Resolved By:</span> {data.resolved_by?.display_name || '-'}</p>
              <p><span className="font-bold text-slate-800">Resolution Time:</span> {formatDate(data.resolved_at)}</p>
            </div>
            {afterImages.length ? <div className="mt-4"><AttachmentGrid attachments={afterImages} /></div> : null}
          </DetailCard>

          <DetailCard title="Client Feedback">
            <div className="space-y-2 text-xs leading-5 text-slate-600">
              <p><span className="font-bold text-slate-800">Rating:</span> {data.rating ? `${data.rating} / 5` : 'Not rated'}</p>
              <p><span className="font-bold text-slate-800">Feedback:</span> {data.client_feedback || '-'}</p>
              <p><span className="font-bold text-slate-800">Satisfaction:</span> {titleCase(data.satisfaction_status || 'Pending')}</p>
            </div>
          </DetailCard>

          <ReadOnlyNote />
        </aside>
      </div>
    </div>
  );
}

function friendlyError(error) {
  const status = error?.response?.status;
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'Your account is not authorised to view the Hospital Ticket dashboard.';
  return error?.response?.data?.message || 'Unable to load Hospital Tickets. Please try again.';
}

export default function Tickets() {
  usePageTitle('Tickets');
  const navigate = useNavigate();
  const { ticketId } = useParams();
  const [tickets, setTickets] = useState([]);
  const [summary, setSummary] = useState({});
  const [pagination, setPagination] = useState({ page: 1, page_size: 25, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    priority: 'all',
    page: 1,
    page_size: 25,
  });
  const requestIdRef = useRef(0);

  const apiParams = useMemo(() => {
    const params = {
      page: filters.page,
      page_size: filters.page_size,
    };
    if (filters.search.trim()) params.search = filters.search.trim();
    if (filters.status !== 'all') params.status = filters.status;
    if (filters.priority !== 'all') params.priority = filters.priority;
    return params;
  }, [filters]);

  const loadTickets = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const [listResponse, summaryResponse] = await Promise.all([
        getHospitalTickets(apiParams),
        getHospitalTicketSummary(apiParams),
      ]);
      if (requestId !== requestIdRef.current) return;
      setTickets(listResponse.tickets || []);
      setPagination(listResponse.pagination || { page: 1, page_size: 25, total: 0, total_pages: 1 });
      setSummary(summaryResponse.counts || {});
      setLastRefreshed(new Date().toISOString());
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(friendlyError(loadError));
      setTickets([]);
      setSummary({});
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [apiParams]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadTickets();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadTickets]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? value : 1 }));
  }

  if (ticketId) {
    return <TicketDetailRoute ticketId={ticketId} onBack={() => navigate('/tickets')} />;
  }

  const kpis = kpiMeta.map((item) => Object.assign([...item], { value: summary[item[0]] || 0 }));
  const denied = error.toLowerCase().includes('not authorised') || error.toLowerCase().includes('authorized');

  return (
    <div className="relative space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Tickets</h1>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-500" />Live Hospital Ticketing data</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">{relativeRefresh(lastRefreshed)}</span>
          <button onClick={loadTickets} disabled={loading} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>

      {error ? <ErrorPanel message={error} onRetry={loadTickets} denied={denied} /> : null}

      {!error ? (
        <div className="grid min-w-0 gap-4">
          <main className="min-w-0 space-y-4">
            <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">{kpis.map((item) => <StatCard key={item[0]} item={item} />)}</section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
              <div className="grid gap-2 border-b border-slate-200 bg-slate-50/70 p-3 md:grid-cols-[minmax(190px,1fr)_repeat(2,minmax(130px,0.55fr))_auto]">
                <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Search ticket number, title, description..." className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none" /></label>
                <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <select value={filters.priority} onChange={(event) => updateFilter('priority', event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">{priorityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <button onClick={loadTickets} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700"><Filter className="h-4 w-4" />Apply</button>
              </div>

              {loading ? <LoadingPanel /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1240px] text-left">
                    <thead><tr className="border-b border-slate-200 bg-white text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{['Ticket ID', 'Client', 'Block / Location', 'Category', 'Priority', 'Status', 'Assigned To', 'Escalation', 'SLA', 'Created On', 'Rating', 'Actions'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                    <tbody>
                      {tickets.map((ticket) => {
                        return (
                          <tr key={ticket.id} onDoubleClick={() => navigate(`/tickets/${encodeURIComponent(ticket.id)}`)} className="border-b border-slate-100 text-[11px] last:border-0 hover:bg-slate-50">
                            <td className="whitespace-nowrap px-3 py-3 font-extrabold text-slate-800">
                              <button onClick={() => navigate(`/tickets/${encodeURIComponent(ticket.id)}`)} className="focus-ring rounded text-left text-blue-700 hover:underline">{ticket.ticket_no}</button>
                              {ticket.uat ? <Pill className="ml-2 bg-violet-50 text-violet-700 ring-violet-200">UAT</Pill> : null}
                            </td>
                            <td className="px-3 py-3 font-bold text-slate-700">{ticket.client?.name || '-'}</td>
                            <td className="max-w-56 px-3 py-3 font-semibold leading-4 text-slate-600">{shortLocation(ticket)}{ticket.reopen_count ? <Pill className="mt-1 bg-rose-50 text-rose-700 ring-rose-200">Reopened</Pill> : null}</td>
                            <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><Wrench className="h-3.5 w-3.5 text-blue-500" />{ticket.category?.name || '-'}</span></td>
                            <td className="px-3 py-3"><Pill className={priorityStyles[ticket.priority] || priorityStyles.medium}>{titleCase(ticket.priority)}</Pill></td>
                            <td className="px-3 py-3"><Pill className={statusStyles[ticket.status_code] || statusStyles.open}>{statusLabel(ticket.status_code)}</Pill></td>
                            <td className="max-w-40 px-3 py-3 font-semibold leading-4 text-slate-600">{ticket.current_assignee?.display_name || <Pill className="bg-amber-50 text-amber-700 ring-amber-200">Unassigned</Pill>}</td>
                            <td className="px-3 py-3 text-slate-600">{titleCase(ticket.current_escalation_level)}</td>
                            <td className="px-3 py-3">{ticket.sla?.due_at ? <Pill className={ticket.overdue ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}>{ticket.overdue ? 'Overdue' : statusLabel(ticket.sla.state)}</Pill> : <Pill className="bg-slate-100 text-slate-600 ring-slate-200">No SLA</Pill>}</td>
                            <td className="max-w-32 px-3 py-3 text-slate-500">{formatDate(ticket.raised_at)}</td>
                            <td className="px-3 py-3 text-slate-600">{ticket.rating ? <span className="inline-flex items-center gap-1 font-bold text-amber-600"><Star className="h-3.5 w-3.5 fill-amber-400" />{ticket.rating}</span> : '-'}</td>
                            <td className="px-3 py-3"><button onClick={() => navigate(`/tickets/${encodeURIComponent(ticket.id)}`)} className="focus-ring rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700">View</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!tickets.length ? <div className="grid min-h-48 place-items-center text-center"><div><SlidersHorizontal className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-bold text-slate-600">No hospital tickets match these filters</p><p className="mt-1 text-xs text-slate-400">Try clearing filters or refreshing live data.</p></div></div> : null}
                </div>
              )}

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500">
                <span>Showing page {pagination.page} of {pagination.total_pages} / {pagination.total} tickets</span>
                <div className="flex items-center gap-1">
                  <button disabled={pagination.page <= 1 || loading} onClick={() => updateFilter('page', Math.max(1, pagination.page - 1))} className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-blue-600 px-2 text-[10px] font-bold text-white">{pagination.page}</span>
                  <button disabled={pagination.page >= pagination.total_pages || loading} onClick={() => updateFilter('page', pagination.page + 1)} className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </footer>
            </section>
          </main>
        </div>
      ) : null}
    </div>
  );
}
