import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Battery,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  MapPin,
  RadioTower,
  ShieldCheck,
  Star,
  Ticket,
  TrendingUp,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DataTable from '../components/DataTable.jsx';
import KpiCard from '../components/KpiCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useWorkflow } from '../context/workflow-context.js';
import {
  operationsDetailSections,
  siteVisitTrend,
  stateOperationsSummary,
} from '../data/qpmsWorkflowData.js';
import { usePageTitle } from '../hooks/usePageTitle.js';

const chartGrid = '#e2e8f0';
const chartText = '#64748b';
const tooltipStyle = { borderRadius: 8, borderColor: '#e2e8f0', fontSize: 11 };
const mapCoordinates = {
  'Tamil Nadu': [13.0827, 80.2707],
  Kerala: [9.9312, 76.2673],
  Karnataka: [12.9716, 77.5946],
  Telangana: [17.385, 78.4867],
  'Andhra Pradesh - 1': [17.6868, 83.2185],
  'Andhra Pradesh - 2': [16.5062, 80.648],
};
const siteCoordinates = {
  'Aster Medcity': mapCoordinates.Kerala,
  'BluePeak Tower': mapCoordinates.Karnataka,
  'Metro Retail Parks': mapCoordinates.Telangana,
  'Port Admin Block': mapCoordinates['Andhra Pradesh - 2'],
};

function findLead(leads, visit) {
  return leads.find((lead) => String(lead.id) === String(visit.lead_id || visit.leadId)) || {};
}

function CommandPanel({ title, action, className = '', children }) {
  return (
    <section className={`command-panel ${className}`}>
      <div className="command-panel-head">
        <h2 className="command-title">{title}</h2>
        {action}
      </div>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

function Metric({ label, value, icon: Icon, change, tone = 'blue' }) {
  const iconTone = {
    blue: 'bg-qpms-50 text-qpms-600 dark:bg-qpms-500/15 dark:text-qpms-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    orange: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  }[tone];
  return (
    <article className="command-kpi">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="command-label">{label}</p>
          <p className="mt-1.5 text-[23px] font-bold leading-none text-slate-950 dark:text-white">{value}</p>
        </div>
        {Icon ? <span className={`rounded-lg p-2 ${iconTone}`}><Icon className="h-4 w-4" /></span> : null}
      </div>
      {change ? <p className="mt-2 text-[11px] font-semibold text-emerald-600">{change}</p> : null}
    </article>
  );
}

function Ring({ value, label, tone = '#13a863', size = 104 }) {
  return (
    <div className="relative grid place-items-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(${tone} ${value}%, #e2e8f0 ${value}% 100%)` }}>
      <div className="grid h-[74%] w-[74%] place-items-center rounded-full bg-white text-center dark:bg-[#081522]">
        <div>
          <p className="text-xl font-bold text-slate-950 dark:text-white">{value}%</p>
          <p className="text-[9px] font-semibold text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function SiteHealthMap({ sites, onSiteSelect, height = 'h-[232px]' }) {
  return (
    <div className={`${height} isolate overflow-hidden rounded-md border border-slate-100 dark:border-slate-800`}>
      <MapContainer center={[13.1, 78.2]} zoom={5.4} scrollWheelZoom className="h-full w-full">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {sites.map((site) => (
          <CircleMarker
            key={site.siteId}
            center={site.coordinates}
            radius={8}
            pathOptions={{
              color: '#fff',
              weight: 2,
              fillOpacity: 0.96,
              fillColor: site.status === 'Critical' ? '#ef4444' : site.status === 'Warning' ? '#f59e0b' : '#13a863',
            }}
            eventHandlers={{ click: () => onSiteSelect?.(site) }}
          >
            <Popup>
              <p className="font-bold">{site.site}</p>
              <p>{site.branch}, {site.state}</p>
              <button type="button" className="mt-2 text-xs font-bold text-qpms-600" onClick={() => onSiteSelect?.(site)}>Open operations</button>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function buildOperationalSites() {
  const health = {
    'Aster Medcity': { sla: 94, tickets: 12, manpower: '78 / 85', attendance: 92, rating: '4.6 / 5', contract: 'Rs 2.45 Cr / Year', risk: 'Medium' },
    'BluePeak Tower': { sla: 88, tickets: 18, manpower: '56 / 60', attendance: 89, rating: '4.2 / 5', contract: 'Rs 1.62 Cr / Year', risk: 'Medium' },
    'Metro Retail Parks': { sla: 95, tickets: 9, manpower: '42 / 46', attendance: 93, rating: '4.7 / 5', contract: 'Rs 1.30 Cr / Year', risk: 'Low' },
    'Port Admin Block': { sla: 84, tickets: 26, manpower: '34 / 44', attendance: 82, rating: '3.8 / 5', contract: 'Rs 96 L / Year', risk: 'High' },
  };
  return operationsDetailSections.activeSites.rows.map((site) => ({
    ...site,
    ...health[site.site],
    coordinates: siteCoordinates[site.site],
    pendingInspections: site.status === 'Critical' ? 7 : site.status === 'Warning' ? 4 : 3,
    assetIssues: site.status === 'Critical' ? 9 : site.status === 'Warning' ? 5 : 2,
  }));
}

function StatusRows({ rows }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center justify-between gap-2 text-[11px] font-semibold">
          <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{row.name}</span>
          <span className={row.tone || 'text-slate-700 dark:text-slate-300'}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function SiteOperationsWorkspace({ site, onBack }) {
  const assetRings = [
    ['HVAC', 87], ['Electrical', 82], ['Plumbing', 90], ['Fire Safety', 75], ['Medical Eq.', 85], ['Lifts', 80],
  ];
  const tickets = operationsDetailSections.openTickets.rows.filter((row) => row.state === site.state || row.site === site.site);
  const recentTickets = tickets.length ? tickets : operationsDetailSections.openTickets.rows;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="command-pill text-qpms-700 dark:text-qpms-200">
          <ArrowLeft className="h-4 w-4" /> Back to Sites Overview
        </button>
        <div className="flex items-center gap-2">
          <span className="command-pill"><CalendarDays className="h-3.5 w-3.5" /> 19 May 2026</span>
          <span className="command-pill"><MapPin className="h-3.5 w-3.5" /> All Regions</span>
        </div>
      </div>

      <section className="command-panel">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-950 dark:text-white">{site.site}, {site.branch}</h1>
              <StatusBadge status={site.status === 'Critical' ? 'Escalated' : 'Active'} />
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">{site.branch}, {site.state} - Operational Facility</p>
          </div>
          <div className="grid grid-cols-2 gap-5 text-xs md:grid-cols-4">
            <div><p className="command-label">Site Code</p><p className="mt-1 font-bold">{site.siteId}</p></div>
            <div><p className="command-label">Client</p><p className="mt-1 font-bold">{site.site}</p></div>
            <div><p className="command-label">Contract Value</p><p className="mt-1 font-bold">{site.contract}</p></div>
            <div><p className="command-label">Contract Period</p><p className="mt-1 font-bold">01 Apr 2026 - 31 Mar 2027</p></div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2 dark:border-slate-800">
          {['Overview', 'Manpower', `Tickets (${site.tickets})`, 'SLA', `Assets (${site.assetIssues})`, 'Inspections', 'Attendance', 'Documents', 'Activity Log'].map((tab, index) => (
            <span key={tab} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-bold ${index === 0 ? 'bg-qpms-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>{tab}</span>
          ))}
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        <Metric label="Manpower Deployed" value={site.manpower} icon={Users} tone="blue" />
        <Metric label="Open Tickets" value={site.tickets} icon={Ticket} tone="red" />
        <Metric label="Pending Inspections" value={site.pendingInspections} icon={ClipboardCheck} tone="green" />
        <Metric label="Asset Issues" value={site.assetIssues} icon={Wrench} tone="orange" />
        <Metric label="SLA Compliance" value={`${site.sla}%`} icon={ShieldCheck} tone="green" />
        <Metric label="Attendance Today" value={`${site.attendance}%`} icon={UserCheck} tone="orange" />
        <Metric label="Client Rating" value={site.rating} icon={Star} tone="orange" />
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.08fr_0.94fr_1fr_0.45fr]">
        <CommandPanel title="Site Location">
          <SiteHealthMap sites={[site]} height="h-[188px]" />
          <div className="mt-2 grid grid-cols-4 text-center text-[10px] font-semibold text-slate-500">
            <span>Site Area<br /><strong className="text-slate-800 dark:text-white">250,000 sq.ft</strong></span>
            <span>Floors<br /><strong className="text-slate-800 dark:text-white">7</strong></span>
            <span>Since<br /><strong className="text-slate-800 dark:text-white">2018</strong></span>
            <span>Type<br /><strong className="text-slate-800 dark:text-white">IFM</strong></span>
          </div>
        </CommandPanel>
        <CommandPanel title="SLA Compliance Overview">
          <div className="flex items-center justify-around gap-3 py-3">
            <Ring value={site.sla} label="Compliant" />
            <StatusRows rows={[
              { name: 'Compliant', value: `${site.sla}%`, tone: 'text-emerald-600' },
              { name: 'At Risk', value: '7%', tone: 'text-amber-600' },
              { name: 'Breached', value: '4%', tone: 'text-rose-600' },
            ]} />
          </div>
        </CommandPanel>
        <CommandPanel title="SLA Trend (This Week)">
          <div className="h-[188px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 320, height: 188 }}>
              <LineChart data={siteVisitTrend}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="completed" stroke="#13a863" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CommandPanel>
        <CommandPanel title="Risk Status">
          <p className={`mt-2 text-sm font-bold ${site.risk === 'High' ? 'text-rose-600' : 'text-amber-600'}`}>{site.risk}</p>
          <p className="command-label mt-7">Last Visit</p>
          <p className="mt-1 text-xs font-bold">Today, 08:15 AM</p>
          <p className="command-label mt-5">Next Visit</p>
          <p className="mt-1 text-xs font-bold">Tomorrow, 08:00 AM</p>
        </CommandPanel>
      </section>

      <section className="grid gap-3 xl:grid-cols-4">
        <CommandPanel title="Recent Tickets">
          <div className="space-y-2">
            {recentTickets.slice(0, 4).map((row) => (
              <div key={row.id} className="grid grid-cols-[62px_1fr_auto] gap-2 text-[11px] font-semibold">
                <span className="text-slate-500">{row.ticketId}</span>
                <span className="truncate">{row.category}</span>
                <span className={row.status === 'Critical' ? 'text-rose-600' : 'text-emerald-600'}>{row.status}</span>
              </div>
            ))}
          </div>
        </CommandPanel>
        <CommandPanel title="Manpower Deployment">
          <div className="flex items-center justify-around gap-3">
            <Ring value={92} label="Deployed" tone="#2f67f5" size={94} />
            <StatusRows rows={[
              { name: 'Housekeeping', value: '38' }, { name: 'Technical', value: '18' }, { name: 'Security', value: '12' }, { name: 'Support', value: '10' },
            ]} />
          </div>
        </CommandPanel>
        <CommandPanel title="FO Attendance Today">
          <div className="flex items-center justify-around gap-3">
            <Ring value={site.attendance} label="Present" size={94} />
            <StatusRows rows={[
              { name: 'Present', value: '72', tone: 'text-emerald-600' }, { name: 'Absent', value: '6', tone: 'text-rose-600' }, { name: 'On Leave', value: '2', tone: 'text-amber-600' },
            ]} />
          </div>
        </CommandPanel>
        <CommandPanel title="Site Activity Timeline">
          <StatusRows rows={[
            { name: '09:15 AM  FO checked in', value: 'Active', tone: 'text-emerald-600' },
            { name: '09:12 AM  Ticket assigned', value: 'Open', tone: 'text-qpms-600' },
            { name: '09:05 AM  Inspection completed', value: 'Done', tone: 'text-emerald-600' },
            { name: '08:45 AM  Attendance marked', value: 'Done', tone: 'text-emerald-600' },
          ]} />
        </CommandPanel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_1.2fr_0.8fr]">
        <CommandPanel title="Asset Health Overview">
          <div className="flex flex-wrap justify-around gap-2 py-2">
            {assetRings.map(([asset, value]) => (
              <div key={asset} className="text-center">
                <Ring value={value} label="" size={52} />
                <p className="mt-1 text-[10px] font-semibold">{asset}</p>
              </div>
            ))}
          </div>
        </CommandPanel>
        <CommandPanel title="Site Map">
          <SiteHealthMap sites={[site]} height="h-[120px]" />
        </CommandPanel>
        <CommandPanel title="Site Documents">
          <StatusRows rows={[
            { name: 'Contract Agreement', value: 'PDF' }, { name: 'SLA Document', value: 'PDF' }, { name: 'Site Layout', value: 'PDF' }, { name: 'Emergency Contact List', value: 'PDF' },
          ]} />
        </CommandPanel>
      </section>

      <section className="command-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {[
          ['Last Inspection', 'Today, 08:00 AM'], ['Last Ticket Closed', 'Today, 07:45 AM'], ['Last FO Visit', 'Today, 08:15 AM'],
          ['Total Distance (Today)', '48.6 km'], ['Auto Expense (Rs 4/km)', 'Rs 194.40'], ['Battery Avg (FO)', '78%'], ['Active FO', '8'],
        ].map(([label, value]) => (
          <div key={label}><p className="command-label">{label}</p><p className="mt-1 text-xs font-bold">{value}</p></div>
        ))}
        <Link to="/fo-activities" className="inline-flex items-center gap-2 rounded-md border border-qpms-200 px-3 py-2 text-xs font-bold text-qpms-700 dark:border-qpms-500/30 dark:text-qpms-300">
          <RadioTower className="h-4 w-4" /> Live FO Tracking
        </Link>
      </section>
    </div>
  );
}

export function ExistingBusinessPage() {
  const [businessType, setBusinessType] = useState('All Businesses');
  const [selectedSite, setSelectedSite] = useState(null);
  usePageTitle(selectedSite ? 'Site Operations' : 'Existing Business');
  const sites = useMemo(() => buildOperationalSites(), []);
  const activeSites = stateOperationsSummary.reduce((total, row) => total + row.activeSites, 0);
  const openTickets = stateOperationsSummary.reduce((total, row) => total + row.tickets, 0);
  const averageSla = Math.round(stateOperationsSummary.reduce((total, row) => total + row.sla, 0) / stateOperationsSummary.length);
  const attendance = Math.round(stateOperationsSummary.reduce((total, row) => total + row.attendance, 0) / stateOperationsSummary.length);

  if (selectedSite) return <SiteOperationsWorkspace site={selectedSite} onBack={() => setSelectedSite(null)} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <PageHeader title="Existing Business Dashboard" />
        <div className="flex gap-2">
          <select value={businessType} onChange={(event) => setBusinessType(event.target.value)} className="command-pill min-w-44 bg-white">
            {['All Businesses', 'Retail', 'Airport', 'GH / Government Hospitals', 'Others'].map((type) => <option key={type}>{type}</option>)}
          </select>
          <span className="command-pill"><MapPin className="h-3.5 w-3.5" /> All Regions</span>
        </div>
      </div>

      <section className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Metric label="Active Sites" value={activeSites} icon={Building2} change="Live coverage" />
        <Metric label="Open Tickets" value={openTickets} icon={Ticket} change="Operational queue" tone="orange" />
        <Metric label="SLA Compliance" value={`${averageSla}%`} icon={ShieldCheck} change="Current status" tone="green" />
        <Metric label="SLA Breached" value="18" icon={AlertTriangle} tone="red" />
        <Metric label="FO Active Today" value="148" icon={Users} change="Workforce live" tone="green" />
        <Metric label="Critical Sites" value={sites.filter((site) => site.status === 'Critical').length} icon={AlertTriangle} tone="red" />
        <Metric label="Client Satisfaction" value="4.6 / 5" icon={Star} tone="orange" />
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.04fr_0.86fr_0.96fr]">
        <CommandPanel title="Site Health Map">
          <SiteHealthMap sites={sites} onSiteSelect={setSelectedSite} />
          <p className="mt-2 text-right text-[11px] font-semibold text-qpms-600">Select a site to open operations</p>
        </CommandPanel>
        <CommandPanel title="SLA Compliance Overview">
          <div className="flex items-center justify-around gap-4 py-6">
            <Ring value={averageSla} label="Compliant" />
            <StatusRows rows={[
              { name: 'Compliant', value: '117', tone: 'text-emerald-600' },
              { name: 'At Risk', value: '9', tone: 'text-amber-600' },
              { name: 'Breached', value: '18', tone: 'text-rose-600' },
            ]} />
          </div>
        </CommandPanel>
        <CommandPanel title="Ticket Summary">
          <div className="flex items-center justify-around gap-4 py-6">
            <Ring value={74} label="Resolved" tone="#2f67f5" />
            <StatusRows rows={[
              { name: 'New', value: '120', tone: 'text-qpms-600' },
              { name: 'In Progress', value: '142', tone: 'text-orange-600' },
              { name: 'On Hold', value: '38', tone: 'text-amber-600' },
              { name: 'Resolved', value: '42', tone: 'text-emerald-600' },
            ]} />
          </div>
        </CommandPanel>
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <CommandPanel title="SLA Breaches">
          <StatusRows rows={sites.map((site, index) => ({ name: site.site, value: `${index + 1}h ${15 + index * 10}m`, tone: 'text-rose-600' }))} />
        </CommandPanel>
        <CommandPanel title="Repeat Complaints">
          <StatusRows rows={sites.map((site, index) => ({ name: site.site, value: `${12 - index * 2}` }))} />
        </CommandPanel>
        <CommandPanel title="Asset Health Overview">
          <div className="flex justify-around">
            {[['HVAC', 87], ['Electrical', 92], ['Plumbing', 83], ['Fire Safety', 90]].map(([name, score]) => (
              <div key={name} className="text-center"><Ring value={score} label="" size={48} /><p className="mt-1 text-[9px] font-semibold">{name}</p></div>
            ))}
          </div>
        </CommandPanel>
        <CommandPanel title="FO Attendance Today">
          <div className="flex items-center justify-around">
            <StatusRows rows={[
              { name: 'Present', value: '456 (92%)', tone: 'text-emerald-600' }, { name: 'Absent', value: '32', tone: 'text-rose-600' }, { name: 'On Leave', value: '8', tone: 'text-amber-600' },
            ]} />
            <Ring value={attendance} label="Present" size={76} />
          </div>
        </CommandPanel>
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <CommandPanel title="Workforce Monitoring">
          <div className="flex items-center justify-around"><Ring value={92} label="Present" size={82} /><StatusRows rows={[{ name: 'Present', value: '456' }, { name: 'Absent', value: '32' }, { name: 'On Leave', value: '8' }]} /></div>
        </CommandPanel>
        <CommandPanel title="Inspection & Compliance">
          <div className="flex items-center justify-around"><Ring value={88} label="Score" size={82} /><StatusRows rows={[{ name: 'Housekeeping', value: '90%' }, { name: 'Technical', value: '85%' }, { name: 'Fire Safety', value: '87%' }]} /></div>
        </CommandPanel>
        <CommandPanel title="Vendor Management">
          <p className="text-2xl font-bold">64</p>
          <StatusRows rows={[{ name: 'On Time', value: '42' }, { name: 'Delayed', value: '15' }, { name: 'Poor Performance', value: '7' }]} />
        </CommandPanel>
        <CommandPanel title="Inventory & Consumables">
          <p className="text-2xl font-bold">12</p>
          <StatusRows rows={[{ name: 'In Stock', value: '156' }, { name: 'Low Stock', value: '12', tone: 'text-amber-600' }, { name: 'Out of Stock', value: '3', tone: 'text-rose-600' }]} />
        </CommandPanel>
      </section>

      <section className="command-panel flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 text-[11px] font-semibold">
        <span className="command-title">Live Ticket Feed</span>
        <span className="text-amber-600">New ticket #TK-3421 at Aster Medcity</span>
        <span className="text-emerald-600">Ticket #TK-319 resolved at BluePeak Tower</span>
        <span className="text-rose-600">SLA breached at Port Admin Block</span>
      </section>
    </div>
  );
}

export function SiteMonitoringPage() {
  const { leads, siteVisits } = useWorkflow();
  usePageTitle('Site Visit + Estimation');
  const rows = siteVisits.map((visit) => {
    const lead = findLead(leads, visit);
    return {
      id: visit.id,
      client: visit.company || lead.company || 'Client pending',
      site: visit.location || lead.location || visit.city || '-',
      stage: visit.currentStage || visit.status || 'Assessment',
      pending: visit.pendingWith || 'BD / Operations',
      updated: visit.lastApprovalAt ? new Date(visit.lastApprovalAt).toLocaleDateString() : 'In progress',
      status: visit.approvalStatus || visit.status || 'Active',
    };
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Site Visit + Estimation" />
      <section className="grid gap-3 sm:grid-cols-3">
        <KpiCard title="Assessments" value={rows.length} change="In workflow" icon={ClipboardCheck} tone="blue" />
        <KpiCard title="Pending Review" value={rows.filter((row) => row.status === 'Pending' || row.stage.includes('Review')).length} change="Awaiting action" icon={ShieldCheck} tone="amber" />
        <KpiCard title="Completed" value={rows.filter((row) => ['Approved', 'Proposal Sent', 'Converted'].includes(row.status)).length} change="Path completed" icon={Building2} tone="green" />
      </section>
      <CommandPanel title="Assessment Monitoring Queue">
        <DataTable columns={[
          { key: 'client', label: 'Client' }, { key: 'site', label: 'Site' }, { key: 'stage', label: 'Current Stage' },
          { key: 'pending', label: 'Pending With' }, { key: 'updated', label: 'Updated' },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
        ]} rows={rows} embedded />
      </CommandPanel>
    </div>
  );
}

export function ProposalCenterPage() {
  const { leads } = useWorkflow();
  usePageTitle('Proposals');
  const proposals = leads
    .filter((lead) => ['Returned to BD', 'Proposal Generated', 'Proposal Sent', 'Converted'].includes(lead.stage) || lead.proposal)
    .map((lead) => ({
      id: lead.id,
      client: lead.company,
      scope: Array.isArray(lead.serviceScope || lead.service_scope) ? (lead.serviceScope || lead.service_scope).join(', ') : 'IFM scope',
      value: lead.proposal?.value || lead.projectedRevenue || '-',
      stage: lead.stage || 'Proposal Ready',
      owner: lead.assigned_bd_executive || 'BD Team',
      status: lead.stage === 'Converted' ? 'Approved' : lead.stage || 'Pending',
    }));
  return (
    <div className="space-y-5">
      <PageHeader title="Proposal Workspace" />
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Proposal Ready" value={proposals.filter((row) => row.stage === 'Returned to BD').length} icon={FileText} />
        <Metric label="Generated" value={proposals.filter((row) => row.stage === 'Proposal Generated').length} icon={FileText} tone="orange" />
        <Metric label="Sent / Converted" value={proposals.filter((row) => ['Proposal Sent', 'Converted'].includes(row.stage)).length} icon={ShieldCheck} tone="green" />
      </section>
      <CommandPanel title="Proposal Preview Queue">
        <DataTable columns={[
          { key: 'client', label: 'Client' }, { key: 'scope', label: 'Scope' }, { key: 'value', label: 'Proposal Value' },
          { key: 'stage', label: 'Stage' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
        ]} rows={proposals} embedded />
      </CommandPanel>
    </div>
  );
}

export function ApprovalCenterPage() {
  const { siteVisits } = useWorkflow();
  usePageTitle('Approvals');
  const stages = ['HR Validation', 'Commercial Review', 'Finance Review', 'Finance GM Approval', 'CFO Review', 'COO Review'];
  const rows = stages.map((stage, index) => {
    const matching = siteVisits.filter((visit) => visit.currentStage === stage || visit.reviewStatus?.[stage]);
    const pending = matching.filter((visit) => (visit.reviewStatus?.[stage] || 'Pending') === 'Pending').length;
    const delayed = matching.filter((visit) => visit.slaStatus === 'Delayed' || visit.status === 'Overdue').length;
    return { id: stage, stage, assigned: matching.length, pending, delayed, aging: pending ? `${index + 1}.${index} days` : '-', status: delayed ? 'Critical' : pending ? 'Pending' : 'Healthy' };
  });
  const pendingCount = rows.reduce((total, row) => total + row.pending, 0);
  const delayedCount = rows.reduce((total, row) => total + row.delayed, 0);
  return (
    <div className="space-y-3">
      <PageHeader title="Approval Command Center" />
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Pending Approvals" value={pendingCount} icon={ShieldCheck} tone="orange" />
        <Metric label="SLA Risk" value={delayedCount} icon={AlertTriangle} tone={delayedCount ? 'red' : 'green'} />
        <Metric label="Rework" value={rows.filter((row) => row.status === 'Critical').length} icon={Activity} tone="orange" />
        <Metric label="Approved Today" value={siteVisits.filter((visit) => visit.approvalStatus === 'Approved').length} icon={CheckCircle2} tone="green" />
        <Metric label="Avg Approval Time" value="2.6 days" icon={TrendingUp} />
      </section>
      <section className="grid gap-3 xl:grid-cols-[0.8fr_0.72fr_1.1fr]">
        <CommandPanel title="Workflow Funnel">
          <div className="space-y-2 py-2">
            {rows.map((row, index) => (
              <div key={row.stage} className="mx-auto flex h-7 items-center justify-center rounded text-[10px] font-bold text-white" style={{ width: `${96 - index * 9}%`, background: ['#2f67f5', '#348de7', '#1fb9c5', '#13a863', '#f59e0b', '#ef4444'][index] }}>
                {row.stage} <span className="ml-3">{row.pending}</span>
              </div>
            ))}
          </div>
        </CommandPanel>
        <CommandPanel title="Approval Aging">
          <div className="flex items-center justify-around py-5">
            <Ring value={Math.min(100, pendingCount * 10)} label="Pending" tone="#f59e0b" />
            <StatusRows rows={rows.slice(0, 4).map((row) => ({ name: row.stage, value: row.aging }))} />
          </div>
        </CommandPanel>
        <CommandPanel title="Workflow Ownership">
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 340, height: 194 }}>
              <BarChart data={rows}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 9, fill: chartText }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="pending" fill="#f59e0b" radius={[5, 5, 0, 0]} />
                <Bar dataKey="delayed" fill="#ef4444" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CommandPanel>
      </section>
      <CommandPanel title="Pending Approvals">
        <DataTable columns={[
          { key: 'stage', label: 'Approval Stage' }, { key: 'assigned', label: 'Records' }, { key: 'pending', label: 'Pending' },
          { key: 'delayed', label: 'SLA Risk' }, { key: 'aging', label: 'Aging' }, { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
        ]} rows={rows} embedded />
      </CommandPanel>
    </div>
  );
}

function OperationalSummaryPage({ mode }) {
  const configs = {
    tickets: { title: 'Tickets', metric: 'tickets', label: 'Open Tickets', icon: Ticket, tone: 'orange' },
    assets: { title: 'Asset Management', metric: 'activeSites', label: 'Monitored Sites', icon: Wrench, tone: 'blue' },
    reports: { title: 'Reports', metric: 'sla', label: 'SLA Average', icon: FileText, tone: 'green' },
  };
  const config = configs[mode];
  usePageTitle(config.title);
  const total = stateOperationsSummary.reduce((sum, row) => sum + (row[config.metric] || 0), 0);
  const average = Math.round(stateOperationsSummary.reduce((sum, row) => sum + row.sla, 0) / Math.max(1, stateOperationsSummary.length));
  return (
    <div className="space-y-5">
      <PageHeader title={config.title} />
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label={config.label} value={mode === 'reports' ? `${average}%` : total} icon={config.icon} tone={config.tone} />
        <Metric label="Regions Monitored" value={stateOperationsSummary.length} icon={Building2} />
        <Metric label="SLA Health" value={`${average}%`} icon={ShieldCheck} tone={average >= 90 ? 'green' : 'orange'} />
      </section>
      <CommandPanel title={`${config.title} by Region`}>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 420, height: 190 }}>
            <BarChart data={stateOperationsSummary}>
              <CartesianGrid stroke={chartGrid} vertical={false} />
              <XAxis dataKey="state" tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey={mode === 'reports' ? 'sla' : config.metric} fill="#2f67f5" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CommandPanel>
      {mode === 'tickets' ? <Link to="/fo-activities" className="inline-flex items-center gap-2 text-sm font-bold text-qpms-600">Open field tracking <ArrowRight className="h-4 w-4" /></Link> : null}
    </div>
  );
}

export function TicketCenterPage() {
  return <OperationalSummaryPage mode="tickets" />;
}

export function AssetCenterPage() {
  return <OperationalSummaryPage mode="assets" />;
}

export function ReportingCenterPage() {
  return <OperationalSummaryPage mode="reports" />;
}
