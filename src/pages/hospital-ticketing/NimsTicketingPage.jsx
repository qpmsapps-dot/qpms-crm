import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, Clock3, ExternalLink,
  Image as ImageIcon, MessageSquareText, RefreshCw, Search, ShieldCheck,
  TicketCheck, UserRound, UsersRound,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { NIMS_HOSPITAL_CLIENT_CODE } from '../../hooks/useHospitalTicketAccess.js';
import {
  getHospitalClientContacts,
  getHospitalTicketDetail,
  getHospitalTicketSummary,
  getHospitalTickets,
} from '../../services/hospitalTicketsApi.js';
import { filterHospitalClientContacts } from '../../utils/hospitalClientContacts.js';

const STATUS_OPTIONS = [
  ['open', 'Open'],
  ['awaiting_supervisor_acceptance', 'Awaiting Supervisor'],
  ['assigned', 'Assigned'],
  ['accepted', 'Accepted'],
  ['in_progress', 'In Progress'],
  ['escalated_operations_executive', 'Escalated to Operations'],
  ['escalated_facility_manager', 'Escalated to Facility Manager'],
  ['escalated_project_head', 'Escalated to Project Head'],
  ['escalated_hospital_dean', 'Escalated to Hospital Dean'],
  ['resolved_awaiting_confirmation', 'Awaiting Client Confirmation'],
  ['reopened', 'Reopened'],
  ['closed', 'Closed'],
  ['cancelled', 'Cancelled'],
];

const STATUS_COLORS = {
  open: '#2563eb', awaiting_supervisor_acceptance: '#d97706', assigned: '#7c3aed',
  accepted: '#0891b2', in_progress: '#0284c7', escalated_operations_executive: '#c026d3',
  escalated_facility_manager: '#db2777', escalated_project_head: '#e11d48',
  escalated_hospital_dean: '#be123c', resolved_awaiting_confirmation: '#f59e0b',
  reopened: '#dc2626', closed: '#059669', cancelled: '#64748b',
};

const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'];
const CHART_COLORS = ['#2563eb', '#0891b2', '#7c3aed', '#d97706', '#059669', '#e11d48', '#64748b'];

function titleCase(value = '') {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusLabel(status, clientView = false) {
  status = String(status || '');
  if (clientView) {
    if (['assigned', 'accepted', 'in_progress'].includes(status)) return 'In Progress';
    if (status === 'awaiting_supervisor_acceptance') return 'Acknowledgement Pending';
    if (status === 'resolved_awaiting_confirmation') return 'Awaiting Your Feedback';
    if (status.startsWith('escalated_')) return 'Escalated for Support';
  }
  return STATUS_OPTIONS.find(([value]) => value === status)?.[1] || titleCase(status);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', hour12: true }).format(date);
}

function ageLabel(value) {
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return '-';
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function locationLabel(ticket) {
  return (ticket.location_path || [ticket.block?.name, ticket.floor_name, ticket.department_name, ticket.location_text])
    .filter(Boolean).join(' / ') || '-';
}

function StatusPill({ status, clientView = false }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: STATUS_COLORS[status] || '#64748b' }}>
      {statusLabel(status, clientView)}
    </span>
  );
}

function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>{action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ text }) {
  return <div className="grid min-h-36 place-items-center text-center text-sm font-semibold text-slate-400">{text}</div>;
}

function TicketingHeader({ view }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase text-blue-600">Hospital Ticketing System</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">NIMS Ticketing System</h1>
        <p className="mt-1 text-sm text-slate-500">Consolidated Hospital Service Ticketing</p>
      </div>
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        <Link className={`rounded-md px-4 py-2 text-xs font-bold ${view === 'qpms' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} to="/hospital-ticketing/nims/qpms">QPMS View</Link>
        <Link className={`rounded-md px-4 py-2 text-xs font-bold ${view === 'client' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} to="/hospital-ticketing/nims/client">Client View</Link>
      </div>
    </div>
  );
}

function Filters({ filters, setFilters, facets, clientView }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
      <label className="relative xl:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input aria-label="Search tickets" className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-xs" placeholder="Ticket number or issue" value={filters.search} onChange={(event) => update('search', event.target.value)} /></label>
      <input aria-label="Date from" className="h-10 rounded-md border border-slate-200 px-3 text-xs" type="date" value={filters.date_from} onChange={(event) => update('date_from', event.target.value)} />
      <input aria-label="Date to" className="h-10 rounded-md border border-slate-200 px-3 text-xs" type="date" value={filters.date_to} onChange={(event) => update('date_to', event.target.value)} />
      <select aria-label="Block" className="h-10 rounded-md border border-slate-200 px-2 text-xs" value={filters.block_id} onChange={(event) => update('block_id', event.target.value)}><option value="">All blocks</option>{(facets.blocks || []).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <select aria-label="Category" className="h-10 rounded-md border border-slate-200 px-2 text-xs" value={filters.category_id} onChange={(event) => update('category_id', event.target.value)}><option value="">All categories</option>{(facets.categories || []).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <select aria-label="Status" className="h-10 rounded-md border border-slate-200 px-2 text-xs" value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">All statuses</option>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{clientView ? statusLabel(value, true) : label}</option>)}</select>
      {!clientView ? <select aria-label="Priority" className="h-10 rounded-md border border-slate-200 px-2 text-xs" value={filters.priority} onChange={(event) => update('priority', event.target.value)}><option value="">All priorities</option>{PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select> : null}
      {!clientView ? <select aria-label="Assignee" className="h-10 rounded-md border border-slate-200 px-2 text-xs" value={filters.assigned_user_id} onChange={(event) => update('assigned_user_id', event.target.value)}><option value="">All assignees</option>{(facets.assignees || []).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select> : null}
      {!clientView ? <select aria-label="Escalation level" className="h-10 rounded-md border border-slate-200 px-2 text-xs" value={filters.escalation_level} onChange={(event) => update('escalation_level', event.target.value)}><option value="">All escalation levels</option>{['supervisor', 'operations_executive', 'facility_manager', 'project_head', 'hospital_dean'].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select> : null}
    </div>
  );
}

function KpiGrid({ counts, clientView }) {
  const internal = [
    ['Total Tickets', counts.total, TicketCheck], ['Active Tickets', counts.active, Clock3],
    ['Awaiting Supervisor', counts.awaiting_supervisor_acceptance, UsersRound], ['Under Process', counts.under_process, RefreshCw],
    ['Escalated', counts.escalated, AlertTriangle], ['Awaiting Client Confirmation', counts.awaiting_client_confirmation, MessageSquareText],
    ['SLA Breached', counts.overdue, AlertTriangle], ['Closed', counts.closed, CheckCircle2], ['Cancelled', counts.cancelled, CheckCircle2],
  ];
  const client = [
    ['Total Tickets', counts.total, TicketCheck], ['Active', counts.active, Clock3],
    ['In Progress', counts.under_process, RefreshCw], ['Escalated', counts.escalated, AlertTriangle],
    ['Awaiting Your Feedback', counts.awaiting_client_confirmation, MessageSquareText],
    ['Closed', counts.closed, CheckCircle2], ['Cancelled', counts.cancelled, CheckCircle2],
  ];
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {(clientView ? client : internal).map(([label, value, Icon]) => (
        <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" key={label}>
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500">{label}</p>{createElement(Icon, { className: 'h-4 w-4 text-blue-600' })}</div>
          <p className="mt-2 text-2xl font-black text-slate-950">{Number(value || 0).toLocaleString('en-IN')}</p>
        </article>
      ))}
    </section>
  );
}

function RegisteredUsersPanel({ contacts, loading, error }) {
  const [search, setSearch] = useState('');
  const visibleContacts = useMemo(
    () => filterHospitalClientContacts(contacts, search),
    [contacts, search],
  );
  return (
    <Panel
      title="NIMS Registered Users"
      action={<span className="text-xs font-bold text-slate-500">Total Users: {contacts.length}</span>}
    >
      <label className="relative block">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          aria-label="Search registered users"
          className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-xs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, designation or mobile"
          value={search}
        />
      </label>
      {error ? <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p> : null}
      {loading ? <p className="mt-3 text-xs font-semibold text-slate-400">Loading registered users...</p> : null}
      {!loading && !error ? (
        <div className="mt-3 max-h-44 overflow-y-auto">
          <div className="sticky top-0 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(6.5rem,0.8fr)] gap-2 border-b border-slate-200 bg-white px-2 py-2 text-[10px] font-bold uppercase text-slate-400">
            <span>Full Name</span><span>Designation</span><span>Mobile</span>
          </div>
          {visibleContacts.map((contact, index) => (
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(6.5rem,0.8fr)] gap-2 border-b border-slate-100 px-2 py-2.5 text-xs" key={`${contact.mobile}-${index}`}>
              <span className="truncate font-semibold text-slate-800" title={contact.full_name}>{contact.full_name || '-'}</span>
              <span className="truncate text-slate-600" title={contact.designation}>{contact.designation || '-'}</span>
              <span className="whitespace-nowrap text-slate-600">{contact.mobile || '-'}</span>
            </div>
          ))}
          {!visibleContacts.length ? <p className="py-6 text-center text-xs font-semibold text-slate-400">No registered users found.</p> : null}
        </div>
      ) : null}
    </Panel>
  );
}

function TicketCharts({ analytics, clientView, contacts, contactsLoading, contactsError }) {
  const statusData = (analytics.status || []).map((item) => ({ ...item, label: statusLabel(item.key, clientView) }));
  if (clientView) {
    return (
      <section className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.2fr)]">
        <Panel title="Ticket Trend"><div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={analytics.trend || []}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Legend /><Line dataKey="raised" name="Raised" stroke="#2563eb" strokeWidth={2} /><Line dataKey="closed" name="Closed" stroke="#059669" strokeWidth={2} /></LineChart></ResponsiveContainer></div></Panel>
        <Panel title="Tickets by Block"><div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={(analytics.block || []).slice(0, 8)}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill="#0891b2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
        <RegisteredUsersPanel contacts={contacts} loading={contactsLoading} error={contactsError} />
      </section>
    );
  }
  return (
    <section className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-4">
      <Panel title="Ticket Trend"><div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={analytics.trend || []}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Legend /><Line dataKey="raised" name="Raised" stroke="#2563eb" strokeWidth={2} /><Line dataKey="closed" name="Closed" stroke="#059669" strokeWidth={2} /></LineChart></ResponsiveContainer></div></Panel>
      <Panel title="Tickets by Status"><div className="h-52"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} dataKey="count" nameKey="label" innerRadius={45} outerRadius={72}>{statusData.map((item, index) => <Cell key={item.key} fill={STATUS_COLORS[item.key] || CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer></div></Panel>
      <Panel title="Tickets by Category"><div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={(analytics.category || []).slice(0, 8)} layout="vertical"><CartesianGrid stroke="#e2e8f0" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></Panel>
      <Panel title={clientView ? 'Tickets by Block' : 'Ticket Ageing'}><div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={clientView ? (analytics.block || []).slice(0, 8) : analytics.ageing || []}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill="#0891b2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
    </section>
  );
}

function NeedsAttention({ counts }) {
  const rows = [
    ['SLA breached', counts.overdue], ['Escalated', counts.escalated],
    ['Reopened', counts.reopened], ['Unassigned', counts.unassigned],
    ['Awaiting supervisor', counts.awaiting_supervisor_acceptance],
    ['Awaiting client confirmation', counts.awaiting_client_confirmation],
  ];
  return <Panel title="Needs Attention"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">{rows.map(([label, value]) => <div className="rounded-md bg-slate-50 p-3" key={label}><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value || 0}</p></div>)}</div></Panel>;
}

function TicketTable({ tickets, view, expanded, onToggle }) {
  const navigate = useNavigate();
  const clientView = view === 'client';
  const openTicket = (ticket) => navigate(`/hospital-ticketing/nims/${view}/tickets/${encodeURIComponent(ticket.id)}`);
  return (
    <Panel title={clientView ? 'Recent Tickets' : 'Recent / Active Tickets'} action={<button className="inline-flex items-center gap-1 text-xs font-bold text-blue-600" onClick={onToggle}>{expanded ? 'Show recent' : 'View all tickets'}<ExternalLink className="h-3.5 w-3.5" /></button>}>
      {!tickets.length ? <EmptyState text="No NIMS tickets match these filters." /> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-[10px] uppercase text-slate-400">{['Ticket No', 'Block / Location', 'Category / Issue', 'Status', ...(clientView ? [] : ['Assignee']), 'Age', ...(clientView ? [] : ['SLA']), 'Updated', 'Action'].map((heading) => <th className="px-2 py-2" key={heading}>{heading}</th>)}</tr></thead><tbody>{tickets.map((ticket) => <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" key={ticket.id} onClick={() => openTicket(ticket)}><td className="px-2 py-3 font-bold text-blue-700">{ticket.ticket_no}</td><td className="max-w-56 px-2 py-3 text-slate-600">{locationLabel(ticket)}</td><td className="max-w-48 px-2 py-3 text-slate-700">{ticket.category?.name || ticket.title || '-'}</td><td className="px-2 py-3"><StatusPill status={ticket.status_code} clientView={clientView} /></td>{!clientView ? <td className="px-2 py-3 text-slate-600">{ticket.current_assignee?.display_name || 'Unassigned'}</td> : null}<td className="px-2 py-3 text-slate-600">{ageLabel(ticket.raised_at)}</td>{!clientView ? <td className="px-2 py-3 font-semibold text-slate-600">{ticket.overdue ? 'Breached' : titleCase(ticket.sla?.state || 'Not applicable')}</td> : null}<td className="px-2 py-3 text-slate-500">{formatDate(ticket.updated_at)}</td><td className="px-2 py-3"><ExternalLink className="h-4 w-4 text-blue-600" /></td></tr>)}</tbody></table></div>}
    </Panel>
  );
}

function DashboardView({ view }) {
  const clientView = view === 'client';
  const [filters, setFilters] = useState({ search: '', date_from: '', date_to: '', block_id: '', category_id: '', status: '', priority: '', assigned_user_id: '', escalation_level: '' });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [summary, setSummary] = useState({ counts: {}, analytics: {}, facets: {} });
  const [tickets, setTickets] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(clientView);
  const [contactsError, setContactsError] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), 350);
    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  const params = useMemo(() => Object.fromEntries(Object.entries({
    ...filters, search: debouncedSearch, client_code: NIMS_HOSPITAL_CLIENT_CODE,
    presentation: view, page: 1, page_size: expanded ? 50 : 10,
  }).filter(([, value]) => value !== '')), [debouncedSearch, expanded, filters, view]);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true); setError('');
    try {
      const [summaryResult, listResult] = await Promise.all([getHospitalTicketSummary(params), getHospitalTickets(params)]);
      if (requestId !== requestRef.current) return;
      setSummary(summaryResult);
      setTickets(listResult.tickets || []);
    } catch (loadError) {
      if (requestId !== requestRef.current) return;
      setError(loadError?.response?.data?.message || 'Unable to load NIMS Hospital tickets.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [params]);

  // The callback owns request cancellation and loading state for both effects and manual refresh.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!clientView) return undefined;
    let active = true;
    setContactsLoading(true);
    setContactsError('');
    getHospitalClientContacts({
      client_code: NIMS_HOSPITAL_CLIENT_CODE,
      presentation: 'client',
    }).then((result) => {
      if (active) setContacts(result.contacts || []);
    }).catch((contactsLoadError) => {
      if (active) setContactsError(contactsLoadError?.response?.data?.message || 'Unable to load NIMS registered users.');
    }).finally(() => {
      if (active) setContactsLoading(false);
    });
    return () => { active = false; };
  }, [clientView]);

  return (
    <div className="space-y-4">
      <TicketingHeader view={view} />
      <Panel title="Filters" action={<button className="inline-flex items-center gap-1 text-xs font-bold text-blue-600" onClick={load}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>}><Filters filters={filters} setFilters={setFilters} facets={summary.facets || {}} clientView={clientView} /></Panel>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}
      {loading && !tickets.length ? <EmptyState text="Loading live NIMS ticket data..." /> : null}
      {!error && (!loading || tickets.length) ? <><KpiGrid counts={summary.counts || {}} clientView={clientView} /><TicketCharts analytics={summary.analytics || {}} clientView={clientView} contacts={contacts} contactsLoading={contactsLoading} contactsError={contactsError} />{!clientView ? <NeedsAttention counts={summary.counts || {}} /> : null}<TicketTable tickets={tickets} view={view} expanded={expanded} onToggle={() => setExpanded((value) => !value)} /></> : null}
    </div>
  );
}

function AttachmentGallery({ attachments }) {
  if (!attachments.length) return <p className="text-sm text-slate-400">No visible attachments.</p>;
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{attachments.map((attachment) => <a className="overflow-hidden rounded-md border border-slate-200" href={attachment.signed_url || '#'} key={attachment.id} rel="noreferrer" target="_blank">{attachment.signed_url ? <img alt={attachment.original_filename || 'Ticket evidence'} className="aspect-video w-full object-cover" loading="lazy" src={attachment.signed_url} /> : <div className="grid aspect-video place-items-center"><ImageIcon className="h-6 w-6 text-slate-300" /></div>}<p className="truncate px-2 py-2 text-[11px] font-semibold text-slate-600">{attachment.original_filename || titleCase(attachment.attachment_type)}</p></a>)}</div>;
}

function Timeline({ events, clientView }) {
  if (!events.length) return <p className="text-sm text-slate-400">No visible ticket events.</p>;
  return <ol className="space-y-4">{events.map((event) => <li className="grid grid-cols-[12px_1fr] gap-3" key={event.id}><span className="mt-1 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-blue-50" /><div><p className="text-sm font-bold text-slate-800">{statusLabel(event.to_status || event.event_type, clientView)}</p><p className="mt-0.5 text-xs text-slate-500">{event.remarks || titleCase(event.event_type)}</p>{!clientView && event.actor_name ? <p className="mt-1 text-[11px] font-semibold text-slate-400">{event.actor_name} · {titleCase(event.actor_role)} · {formatDate(event.created_at)}</p> : <p className="mt-1 text-[11px] text-slate-400">{formatDate(event.created_at)}</p>}</div></li>)}</ol>;
}

function DetailView({ view, ticketId }) {
  const navigate = useNavigate();
  const clientView = view === 'client';
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setDetail(await getHospitalTicketDetail(ticketId, { client_code: NIMS_HOSPITAL_CLIENT_CODE, presentation: view })); }
    catch (loadError) { setError(loadError?.response?.data?.message || 'Unable to load ticket details.'); }
    finally { setLoading(false); }
  }, [ticketId, view]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  if (loading) return <EmptyState text="Loading ticket details..." />;
  if (error || !detail?.ticket) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error || 'Ticket was not found.'}</div>;
  const ticket = detail.ticket;
  const complaintImages = (detail.attachments || []).filter((item) => item.attachment_type === 'complaint_photo');
  const resolutionImages = (detail.attachments || []).filter((item) => item.attachment_type === 'completion_photo');
  const backPath = `/hospital-ticketing/nims/${view}`;
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-slate-500">Hospital Ticketing System / NIMS Ticketing System / {clientView ? 'Client View' : 'QPMS View'} / Ticket Details</div>
      <header className="flex flex-wrap items-start justify-between gap-3"><div><button className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-blue-600" onClick={() => navigate(backPath)}><ArrowLeft className="h-4 w-4" />Back</button><h1 className="text-2xl font-black text-slate-950">Ticket Details - {ticket.ticket_no}</h1><p className="mt-1 text-sm text-slate-500">{ticket.title || ticket.category?.name || 'Hospital service ticket'}</p></div><div className="flex items-center gap-2"><StatusPill status={ticket.status_code} clientView={clientView} /><button aria-label="Refresh ticket" className="rounded-md border border-slate-200 p-2" onClick={load}><RefreshCw className="h-4 w-4" /></button></div></header>
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">{[
        ['Status', statusLabel(ticket.status_code, clientView)], ['Age', ageLabel(ticket.raised_at)],
        ...(!clientView ? [['SLA', ticket.overdue ? 'Breached' : titleCase(ticket.sla?.state || 'Not applicable')]] : []),
        ['Client', ticket.client?.name || 'NIMS'], ['Block', ticket.block?.name || '-'], ['Category', ticket.category?.name || '-'],
        ...(!clientView ? [['Assignee', ticket.current_assignee?.display_name || 'Unassigned'], ['Escalation', titleCase(ticket.current_escalation_level || '-')]] : []),
      ].map(([label, value]) => <div className="rounded-md border border-slate-200 bg-white p-3" key={label}><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-bold text-slate-800">{value}</p></div>)}</section>
      <div className={`grid gap-4 ${clientView ? 'xl:grid-cols-[1.15fr_0.85fr]' : 'xl:grid-cols-[1.2fr_0.8fr]'}`}>
        <main className="space-y-4">
          <Panel title="Ticket Overview"><dl className="grid gap-3 text-sm sm:grid-cols-2">{[['Ticket No', ticket.ticket_no], ['Issue', ticket.title], ['Requester', ticket.raised_by?.name], ['Raised', formatDate(ticket.raised_at)], ['Block / Location', locationLabel(ticket)], ['Category', ticket.category?.name], ['Current Status', statusLabel(ticket.status_code, clientView)]].map(([label, value]) => <div key={label}><dt className="text-[10px] font-bold uppercase text-slate-400">{label}</dt><dd className="mt-1 font-semibold text-slate-700">{value || '-'}</dd></div>)}</dl><p className="mt-4 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-700">{ticket.description || ticket.description_preview || '-'}</p></Panel>
          <Panel title={clientView ? 'Progress Timeline' : 'Status Timeline'}><Timeline events={detail.timeline || []} clientView={clientView} /></Panel>
          <Panel title="Complaint Evidence"><AttachmentGallery attachments={complaintImages} /></Panel>
          {!clientView ? <Panel title="Comments / Notes">{(detail.comments || []).length ? <div className="space-y-3">{detail.comments.map((comment) => <article className="rounded-md bg-slate-50 p-3" key={comment.id}><p className="text-xs font-bold text-slate-800">{comment.author_name || 'QPMS Team'} · {titleCase(comment.comment_type)}</p><p className="mt-1 text-sm text-slate-600">{comment.comment_text}</p><p className="mt-1 text-[11px] text-slate-400">{formatDate(comment.created_at)}</p></article>)}</div> : <p className="text-sm text-slate-400">No comments recorded.</p>}</Panel> : null}
        </main>
        <aside className="space-y-4">
          {!clientView ? <Panel title="Assignment & Ownership"><div className="space-y-2 text-sm text-slate-600"><p><strong>Current assignee:</strong> {ticket.current_assignee?.display_name || 'Unassigned'}</p><p><strong>Accepted by:</strong> {ticket.accepted_by?.display_name || '-'}</p><p><strong>Current level:</strong> {titleCase(ticket.current_escalation_level || '-')}</p></div></Panel> : null}
          {!clientView ? <Panel title="SLA & Performance"><div className="space-y-2 text-sm text-slate-600"><p><strong>Status:</strong> {ticket.overdue ? 'Breached' : titleCase(ticket.sla?.state || 'Not applicable')}</p><p><strong>Resolution due:</strong> {formatDate(ticket.supervisor_sla_due_at)}</p><p><strong>Accepted:</strong> {formatDate(ticket.accepted_at)}</p><p><strong>Work started:</strong> {formatDate(ticket.work_started_at)}</p><p><strong>Resolved:</strong> {formatDate(ticket.resolved_at)}</p></div></Panel> : null}
          <Panel title="Resolution & Feedback"><div className="space-y-2 text-sm text-slate-600"><p><strong>Resolution:</strong> {ticket.resolution_remarks || 'Not submitted'}</p><p><strong>Resolved:</strong> {formatDate(ticket.resolved_at)}</p><p><strong>Closed:</strong> {formatDate(ticket.closed_at)}</p><p><strong>Feedback:</strong> {ticket.client_feedback || '-'}</p><p><strong>Rating:</strong> {ticket.rating ? `${ticket.rating} / 5` : '-'}</p></div><div className="mt-4"><AttachmentGallery attachments={resolutionImages} /></div></Panel>
          {!clientView ? <Panel title="Assignment History">{(detail.assignment_history || []).length ? <div className="space-y-3">{detail.assignment_history.map((item) => <div className="border-l-2 border-blue-200 pl-3 text-xs text-slate-600" key={item.id}><p className="font-bold text-slate-800">{titleCase(item.assignment_type || 'Assignment')}</p><p>{item.reason || `${titleCase(item.previous_status)} to ${titleCase(item.resulting_status)}`}</p><p className="text-[11px] text-slate-400">{formatDate(item.assigned_at)}</p></div>)}</div> : <p className="text-sm text-slate-400">No assignment changes recorded.</p>}</Panel> : null}
          {clientView ? <Panel title="Latest Update"><p className="text-sm leading-6 text-slate-600">{detail.timeline?.at(-1)?.remarks || statusLabel(ticket.status_code, true)}</p><p className="mt-2 text-xs text-slate-400">{formatDate(detail.timeline?.at(-1)?.created_at || ticket.updated_at)}</p></Panel> : null}
        </aside>
      </div>
    </div>
  );
}

export function LegacyHospitalTicketsRedirect() {
  const location = useLocation();
  const match = location.pathname.match(/^\/tickets\/([^/]+)$/);
  return <LinkRedirect to={match ? `/hospital-ticketing/nims/qpms/tickets/${match[1]}` : '/hospital-ticketing/nims/qpms'} />;
}

function LinkRedirect({ to }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to, { replace: true }); }, [navigate, to]);
  return <EmptyState text="Opening NIMS Ticketing System..." />;
}

export default function NimsTicketingPage() {
  usePageTitle('NIMS Ticketing System');
  const { pathname } = useLocation();
  const view = pathname.includes('/client') ? 'client' : 'qpms';
  const detailMatch = pathname.match(/\/tickets\/([^/]+)$/);
  return detailMatch
    ? <DetailView view={view} ticketId={decodeURIComponent(detailMatch[1])} />
    : <DashboardView view={view} />;
}
