import { createElement, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Filter,
  FolderOpen,
  Image as ImageIcon,
  MapPin,
  MoreHorizontal,
  Search,
  Send,
  SlidersHorizontal,
  Tag,
  TicketCheck,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import corridorImage from '../../Client_Ticketing_App/assets/mock_photos/corridor_light.svg';
import panelImage from '../../Client_Ticketing_App/assets/mock_photos/electrical_panel.svg';
import wiringImage from '../../Client_Ticketing_App/assets/mock_photos/wiring.svg';
import { featuredTicketDetails, mockTickets, ticketSummary } from '../data/ticketMockData.js';
import { usePageTitle } from '../hooks/usePageTitle.js';

const toneStyles = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const statusStyles = {
  Open: 'bg-blue-50 text-blue-700 ring-blue-200',
  Assigned: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'In Progress': 'bg-sky-50 text-sky-700 ring-sky-200',
  Escalated: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  Closed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const priorityStyles = {
  High: 'bg-rose-50 text-rose-700 ring-rose-200',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  Low: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const activityDots = {
  pink: 'bg-pink-500',
  blue: 'bg-blue-500',
  slate: 'bg-slate-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
};

const evidenceImages = [
  { src: wiringImage, label: 'Leaking pipe under sink' },
  { src: corridorImage, label: 'Wet restroom floor and drain' },
  { src: panelImage, label: 'Damaged plumbing fitting' },
  { src: wiringImage, label: 'Pipe joint close-up' },
];

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${className}`}>{children}</span>;
}

function StatCard({ item, index }) {
  const icons = [TicketCheck, FolderOpen, CircleUserRound, CheckCircle2];
  const Icon = icons[index];
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500">{item.label}</p>
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{item.value}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-2xl ring-1 ring-inset ${toneStyles[item.tone]}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className={`mt-3 text-[11px] font-bold ${item.tone === 'orange' ? 'text-orange-600' : item.tone === 'purple' ? 'text-violet-600' : 'text-emerald-600'}`}>{item.trend}</p>
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

function TicketDrawer({ ticket, onClose, commentsRef, activity, comment, setComment, onAddComment, onAction }) {
  const details = featuredTicketDetails;
  return (
    <aside className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 shadow-[0_18px_60px_rgba(15,23,42,0.12)]">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-slate-950">View Ticket</h2>
          <button onClick={onClose} className="focus-ring rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close ticket panel"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-black leading-6 text-slate-950">{ticket.title}</h3>
          <button className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-slate-600" title="Copy ticket code">{ticket.id}<Copy className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill className={statusStyles[ticket.status] || statusStyles.Open}>{ticket.status}</Pill>
          <Pill className={priorityStyles[ticket.priority]}>{ticket.priority} Priority</Pill>
          <Pill className="bg-white text-slate-700 ring-slate-200"><Wrench className="mr-1 h-3 w-3 text-blue-600" />{ticket.category}</Pill>
        </div>
      </header>

      <div className="max-h-[calc(100vh-13rem)] space-y-3 overflow-y-auto p-3.5">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ['Client', ticket.client, CircleUserRound],
              ['Site', ticket.site, MapPin],
              ['Contact Person', `${details.contact}\n${details.contactPhone}`, UserRound],
              ['Created On', details.createdOn, Clock3],
              ['SLA Due', details.slaDue, AlertTriangle],
              ['Category', ticket.category, Tag],
            ].map(([label, value, MetaIcon]) => (
              <div key={label} className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{createElement(MetaIcon, { className: 'h-3.5 w-3.5' })}{label}</p>
                <p className="mt-1 whitespace-pre-line text-xs font-bold leading-5 text-slate-800">{value}</p>
                {label === 'SLA Due' ? <Pill className="mt-1 bg-rose-50 text-rose-700 ring-rose-200">{details.slaRemaining}</Pill> : null}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Issue Description</p>
            <p className="mt-1.5 text-xs leading-5 text-slate-600">{details.description}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-extrabold text-slate-800">Site Images (4)</h3><button className="text-[11px] font-bold text-blue-600">View all</button></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {evidenceImages.map((image, index) => <button key={`${image.label}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100" title={image.label}><img src={image.src} alt={image.label} className="h-20 w-full object-cover transition group-hover:scale-105" /><span className="absolute bottom-1 right-1 rounded bg-slate-950/65 p-1 text-white"><ImageIcon className="h-3 w-3" /></span></button>)}
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-2">
          <DetailCard title="Activity / Comments" className="xl:row-span-2">
            <div ref={commentsRef} className="space-y-4 scroll-mt-24">
              {activity.map((item, index) => (
                <div key={`${item.role}-${item.time}-${index}`} className="relative flex gap-3 pl-1">
                  {index < activity.length - 1 ? <span className="absolute left-[9px] top-5 h-[calc(100%+8px)] w-px bg-slate-200" /> : null}
                  <span className={`relative mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-4 ring-white ${activityDots[item.tone] || 'bg-blue-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-1"><p className="text-[11px] font-extrabold text-slate-800">{item.role}</p><time className="text-[9px] text-slate-400">{item.time}</time></div>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{item.message}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Add internal comment..." className="focus-ring min-h-16 flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none placeholder:text-slate-400" />
                <button onClick={onAddComment} disabled={!comment.trim()} className="focus-ring grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white disabled:opacity-40" aria-label="Add comment"><Send className="h-4 w-4" /></button>
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Escalation Matrix / Status Flow">
            <div className="flex items-start">
              {details.statusFlow.map((step, index) => (
                <div key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                  {index ? <span className={`absolute right-1/2 top-2 h-0.5 w-full ${step.state === 'pending' ? 'bg-slate-200' : 'bg-emerald-400'}`} /> : null}
                  <span className={`relative z-10 grid h-4 w-4 place-items-center rounded-full border-2 ${step.state === 'active' ? 'border-blue-600 bg-white ring-2 ring-blue-100' : step.state === 'complete' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'}`}>{step.state === 'complete' ? <CheckCircle2 className="h-3 w-3 text-white" /> : null}</span>
                  <p className={`mt-2 text-[8px] font-bold ${step.state === 'active' ? 'text-blue-700' : 'text-slate-600'}`}>{step.label}</p>
                  <p className="mt-1 text-[7px] leading-3 text-slate-400">{step.time}</p>
                </div>
              ))}
            </div>
          </DetailCard>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailCard title="Assignment">
              <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-blue-700"><UserRound className="h-4 w-4" /></span><div><p className="text-[10px] text-slate-400">Assigned FO</p><p className="text-xs font-extrabold text-slate-800">M. Karthik</p><p className="text-[10px] text-slate-500">QPMSTN5702</p></div></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]"><div><p className="text-slate-400">Status</p><Pill className="mt-1 bg-emerald-50 text-emerald-700 ring-emerald-200">Accepted</Pill></div><div><p className="text-slate-400">Assigned on</p><p className="mt-1 font-semibold text-slate-700">19 May, 04:20 PM</p></div></div>
              <button onClick={() => onAction('FO profile opened')} className="focus-ring mt-3 w-full rounded-lg border border-blue-200 px-3 py-2 text-[10px] font-bold text-blue-700">View FO Profile</button>
            </DetailCard>
            <DetailCard title="History / Notifications">
              <div className="space-y-3">{details.history.map((item) => <div key={item} className="flex gap-2 text-[9px] leading-4 text-slate-500"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /><span>{item}</span></div>)}</div>
            </DetailCard>
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-200 bg-white p-3 sm:grid-cols-5">
        <button onClick={() => onAction('Comment added')} className="focus-ring rounded-lg bg-blue-600 px-3 py-2.5 text-[10px] font-bold text-white">Add Comment</button>
        <button onClick={() => onAction('Reassign workflow opened')} className="focus-ring rounded-lg border border-slate-300 px-3 py-2.5 text-[10px] font-bold text-slate-700">Reassign</button>
        <button onClick={() => onAction('Escalation workflow opened')} className="focus-ring rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-[10px] font-bold text-orange-700">Escalate</button>
        <button onClick={() => onAction('Resolve workflow opened')} className="focus-ring rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[10px] font-bold text-emerald-700">Resolve</button>
        <button onClick={() => onAction('Close workflow opened')} className="focus-ring rounded-lg border border-rose-300 px-3 py-2.5 text-[10px] font-bold text-rose-700">Close Ticket</button>
      </footer>
    </aside>
  );
}

export default function Tickets() {
  usePageTitle('Tickets');
  const [selectedTicket, setSelectedTicket] = useState(mockTickets[2]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All Statuses');
  const [priority, setPriority] = useState('All Priorities');
  const [category, setCategory] = useState('All Categories');
  const [comment, setComment] = useState('');
  const [activity, setActivity] = useState(featuredTicketDetails.activity);
  const [toast, setToast] = useState('');
  const commentsRef = useRef(null);

  const filteredTickets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return mockTickets.filter((ticket) => {
      const matchesSearch = !needle || Object.values(ticket).some((value) => String(value).toLowerCase().includes(needle));
      return matchesSearch && (status === 'All Statuses' || ticket.status === status) && (priority === 'All Priorities' || ticket.priority === priority) && (category === 'All Categories' || ticket.category === category);
    });
  }, [category, priority, search, status]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }

  function openTicket(ticket, focusComments = false) {
    setSelectedTicket(ticket);
    if (focusComments) window.setTimeout(() => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function addComment() {
    const message = comment.trim();
    if (!message) return;
    setActivity((items) => [...items, { role: 'Operations Manager', message, time: 'Just now', tone: 'blue' }]);
    setComment('');
    showToast('Internal comment added locally');
  }

  return (
    <div className="relative space-y-4">
      {toast ? <div className="toast-enter fixed right-6 top-20 z-50 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white shadow-xl">{toast}</div> : null}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-black tracking-tight text-slate-950">Tickets</h1>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-500" />Synced from QPMS mobile/client app</span>
      </div>

      <div className={`grid min-w-0 gap-4 ${selectedTicket ? 'xl:grid-cols-[minmax(0,1.12fr)_minmax(500px,0.88fr)]' : ''}`}>
        <main className="min-w-0 space-y-4">
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">{ticketSummary.map((item, index) => <StatCard key={item.label} item={item} index={index} />)}</section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
            <div className="grid gap-2 border-b border-slate-200 bg-slate-50/70 p-3 md:grid-cols-[minmax(190px,1fr)_repeat(3,minmax(130px,0.55fr))_auto]">
              <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tickets..." className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none" /></label>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"><option>All Statuses</option>{['Open', 'Assigned', 'In Progress', 'Escalated', 'Closed'].map((value) => <option key={value}>{value}</option>)}</select>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"><option>All Priorities</option>{['High', 'Medium', 'Low'].map((value) => <option key={value}>{value}</option>)}</select>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"><option>All Categories</option>{['HVAC', 'Electrical', 'Plumbing', 'CCTV', 'Access Control'].map((value) => <option key={value}>{value}</option>)}</select>
              <button onClick={() => showToast('Filters applied')} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700"><Filter className="h-4 w-4" />Filters</button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left">
                <thead><tr className="border-b border-slate-200 bg-white text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{['Ticket ID', 'Client', 'Site', 'Category', 'Priority', 'Status', 'Assigned To', 'Created On', 'Actions'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                <tbody>
                  {filteredTickets.map((ticket) => {
                    const selected = selectedTicket?.id === ticket.id;
                    return (
                      <tr key={ticket.id} className={`border-b border-slate-100 text-[11px] last:border-0 ${selected ? 'bg-blue-50/80 shadow-[inset_3px_0_0_#2563eb]' : 'hover:bg-slate-50'}`}>
                        <td className="whitespace-nowrap px-3 py-3 font-extrabold text-slate-800">{ticket.id}</td>
                        <td className="px-3 py-3 font-bold text-slate-700">{ticket.client}</td>
                        <td className="max-w-32 px-3 py-3 font-semibold text-slate-600">{ticket.site}</td>
                        <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><Wrench className="h-3.5 w-3.5 text-blue-500" />{ticket.category}</span></td>
                        <td className="px-3 py-3"><Pill className={priorityStyles[ticket.priority]}>{ticket.priority}</Pill></td>
                        <td className="px-3 py-3"><Pill className={statusStyles[ticket.status]}>{ticket.status}</Pill></td>
                        <td className="max-w-40 px-3 py-3 font-semibold leading-4 text-slate-600">{ticket.assignee}</td>
                        <td className="max-w-32 px-3 py-3 text-slate-500">{ticket.created}</td>
                        <td className="px-3 py-3"><div className="flex items-center gap-1.5"><button onClick={() => openTicket(ticket)} className="focus-ring rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700">View</button><button onClick={() => openTicket(ticket, true)} className="focus-ring rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700">Comment</button><button onClick={() => showToast(`More actions for ${ticket.id}`)} className="focus-ring rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500" aria-label={`More actions for ${ticket.id}`}><MoreHorizontal className="h-4 w-4" /></button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredTickets.length ? <div className="grid min-h-48 place-items-center text-center"><div><SlidersHorizontal className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-bold text-slate-600">No tickets match these filters</p></div></div> : null}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500"><span>Showing 1 to {filteredTickets.length} of 247 tickets</span><div className="flex items-center gap-1"><button className="rounded-lg border border-slate-200 p-1.5"><ChevronLeft className="h-3.5 w-3.5" /></button>{['1', '2', '3', '…', '36'].map((page) => <button key={page} className={`grid h-7 min-w-7 place-items-center rounded-lg text-[10px] font-bold ${page === '1' ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600'}`}>{page}</button>)}<button className="rounded-lg border border-slate-200 p-1.5"><ChevronRight className="h-3.5 w-3.5" /></button></div></footer>
          </section>
        </main>

        {selectedTicket ? <TicketDrawer ticket={selectedTicket} onClose={() => setSelectedTicket(null)} commentsRef={commentsRef} activity={activity} comment={comment} setComment={setComment} onAddComment={addComment} onAction={showToast} /> : null}
      </div>
    </div>
  );
}
