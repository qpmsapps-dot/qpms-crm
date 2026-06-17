import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Layers3,
  MapPin,
  MessageSquareWarning,
  Search,
  TimerReset,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartCard from '../components/ChartCard.jsx';
import DataTable from '../components/DataTable.jsx';
import KpiCard from '../components/KpiCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {
  existingOperationsKpis,
  fieldOfficerActivity,
  operationsDetailSections,
  siteVisitTrend,
  stateOperationsSummary,
} from '../data/qpmsWorkflowData.js';
import { useAuth } from '../context/auth-context.js';
import { useWorkflow } from '../context/workflow-context.js';
import {
  bdExecutives,
  canViewBdTeam,
  isCommercialTeam,
  isCoordinator,
  isExistingBusinessOperations,
  isFinanceLeadership,
  isFinanceTeam,
  isHrReviewer,
  isManagement,
  isOperationsTeam,
} from '../data/mockUsers.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { isDemoMode } from '../config/demoMode.js';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const taskColors = ['#10b981', '#f59e0b', '#ef4444'];
const chartGrid = '#e2e8f0';
const chartText = '#64748b';

const businessFilterOptions = ['All Businesses', 'Reliance Retail', 'Private Clients', 'DME', 'AP DSH', 'TN Government', 'Osmania Hospitals'];
const stateFilterOptions = ['All States', 'Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana', 'Andhra Pradesh - 1', 'Andhra Pradesh - 2'];
const pipelineBusinessOptions = ['All Businesses', 'Retail', 'Healthcare', 'IT / Parks', 'Government', 'Private Clients'];
const pipelineRegionOptions = ['All Regions', 'Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana', 'Andhra Pradesh'];
const dateRangeOptions = ['This Month', 'Last 30 Days', 'This Quarter', 'Year to Date'];

const businessStateCoverage = {
  'Reliance Retail': ['Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana'],
  'Private Clients': ['Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana', 'Andhra Pradesh - 1', 'Andhra Pradesh - 2'],
  DME: ['Andhra Pradesh - 1', 'Andhra Pradesh - 2', 'Telangana'],
  'AP DSH': ['Andhra Pradesh - 1', 'Andhra Pradesh - 2'],
  'TN Government': ['Tamil Nadu'],
  'Osmania Hospitals': ['Telangana'],
};

const businessWeights = {
  'Reliance Retail': 0.34,
  'Private Clients': 0.24,
  DME: 0.16,
  'AP DSH': 0.12,
  'TN Government': 0.08,
  'Osmania Hospitals': 0.06,
};

const tooltipStyle = {
  borderRadius: 14,
  borderColor: '#e2e8f0',
  boxShadow: '0 18px 45px rgba(15,23,42,0.10)',
  fontSize: 12,
};

function formatInr(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const operationsColumns = [
  { key: 'state', label: 'State / Region' },
  { key: 'activeSites', label: 'Active Sites' },
  { key: 'officers', label: 'Field Officers' },
  { key: 'attendance', label: 'Attendance %', render: (row) => `${row.attendance}%` },
  { key: 'visits', label: 'Site Visits Today' },
  { key: 'tickets', label: 'Open Tickets' },
  { key: 'tasks', label: 'Pending Tasks' },
  { key: 'sla', label: 'SLA %', render: (row) => `${row.sla}%` },
  { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
];

const officerColumns = [
  { key: 'name', label: 'Name' },
  { key: 'state', label: 'State' },
  { key: 'branch', label: 'Branch' },
  { key: 'checkIn', label: 'Check-in Time' },
  { key: 'lastActivity', label: 'Last Activity', wrap: true },
  { key: 'assignedSite', label: 'Assigned Site' },
  { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
];

const businessSnapshotColumns = [
  { key: 'business', label: 'Business Name' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'escalations', label: 'Escalations' },
  { key: 'siteVisits', label: 'Site Visits' },
  { key: 'slaHealth', label: 'SLA Health' },
  { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
];

function formatDateInput(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function formatDateTimeCell(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatKm(value) {
  const number = Number(value || 0);
  return `${number.toFixed(2)} km`;
}

function normalizeFoKey(value = '') {
  return String(value).trim().toUpperCase();
}

function dashboardFoKeys(row) {
  return [row?.employee_code, row?.username, row?.fo_user_id]
    .map(normalizeFoKey)
    .filter(Boolean);
}

function isMockFoUser(value = '') {
  const id = String(value).toLowerCase();
  return /^fo0{2,3}[1-5]$/.test(id) || id.includes('test') || id.includes('demo') || id === 'fo-demo-001';
}

function isRealFoProfile(profile) {
  const role = String(profile?.role || '').trim().toLowerCase();
  const status = String(profile?.status || '').trim().toLowerCase();
  const keys = dashboardFoKeys(profile);
  return ['fo', 'field officer'].includes(role)
    && !['deleted', 'disabled', 'inactive', 'blocked'].includes(status)
    && keys.length > 0
    && keys.every((key) => !isMockFoUser(key));
}

function FoGpsTestDashboard() {
  const [date, setDate] = useState(formatDateInput());
  const [foUser, setFoUser] = useState('All');
  const [rows, setRows] = useState([]);
  const [source, setSource] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    async function loadFoGpsRows() {
      if (!isSupabaseConfigured || !supabase) {
        setRows([]);
        setSource('Supabase not configured');
        return;
      }
      try {
        const start = `${date}T00:00:00`;
        const end = `${date}T23:59:59`;
        const [profilesRes, attendanceRes, liveRes, logsRes] = await Promise.all([
          supabase.from('profiles').select('username, employee_code, display_name, full_name, role, status').in('role', ['FO', 'Field Officer']),
          supabase.from('fo_attendance').select('*').gte('login_time', start).lte('login_time', end).order('login_time', { ascending: false }),
          supabase.from('fo_live_status').select('*'),
          supabase.from('fo_location_logs').select('fo_user_id, attendance_id, logged_at, captured_at, battery_percentage').gte('logged_at', start).lte('logged_at', end).order('logged_at', { ascending: false }).limit(1000),
        ]);
        const errors = [profilesRes, attendanceRes, liveRes, logsRes].map((res) => res.error).filter(Boolean);
        if (errors.length) throw errors[0];
        const profiles = (profilesRes.data || []).filter(isRealFoProfile);
        const attendance = attendanceRes.data || [];
        const live = liveRes.data || [];
        const logs = logsRes.data || [];
        const tableRows = profiles.map((profile) => {
          const keys = dashboardFoKeys(profile);
          const username = profile.employee_code || profile.username || keys[0];
          const record = attendance.find((item) => dashboardFoKeys(item).some((key) => keys.includes(key))) || {};
          const liveRow = live.find((item) => dashboardFoKeys(item).some((key) => keys.includes(key))) || {};
          const attendanceLogs = logs.filter((log) => {
            if (record.id) return log.attendance_id === record.id;
            return dashboardFoKeys(log).some((key) => keys.includes(key));
          });
          const latestLog = attendanceLogs[0] || {};
          const eligibleKm = Number(record.eligible_km ?? record.total_approved_km ?? record.total_route_km ?? liveRow.route_km_today ?? 0);
          const rawGpsKm = Number(record.raw_gps_km ?? record.total_raw_km ?? record.actual_km ?? 0);
          const filteredGpsKm = Number(record.filtered_gps_km ?? record.actual_km ?? 0);
          const actualKm = Number(record.actual_travel_km ?? record.actual_km ?? record.total_raw_km ?? 0);
          const rate = Number(record.rate_per_km ?? 4);
          const attendanceEnded = Boolean(record.logout_time);
          const liveActive = liveRow.is_online === true && liveRow.is_tracking === true && !attendanceEnded;
          return {
            username,
            display_name: profile.display_name || profile.full_name || record.display_name || liveRow.display_name || username,
            start: record.login_time,
            end: record.logout_time,
            status: attendanceEnded
              ? 'Completed'
              : liveActive
                ? 'Tracking'
                : liveRow.current_status || record.status || 'Not started',
            lastSeen: liveRow.last_seen_at || latestLog.captured_at || latestLog.logged_at,
            battery: liveRow.battery_percentage ?? latestLog.battery_percentage ?? record.end_battery_percentage ?? record.start_battery_percentage,
            points: attendanceLogs.length,
            actualKm,
            rawGpsKm,
            filteredGpsKm,
            eligibleKm,
            rate,
            petrol: Number(record.petrol_amount ?? eligibleKm * rate),
          };
        }).filter((row) => foUser === 'All' || normalizeFoKey(row.username) === normalizeFoKey(foUser));
        if (!cancelled) {
          setRows(tableRows);
          setSource('Supabase profiles + FO tables');
        }
      } catch (error) {
        console.warn('[myQPMS FO GPS] Dashboard load failed.', error);
        if (!cancelled) {
          setRows([]);
          setSource('Supabase error');
        }
      }
    }
    loadFoGpsRows();
    return () => {
      cancelled = true;
    };
  }, [date, foUser]);

  return (
    <section className="enterprise-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">FO GPS Tracking</h2>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Source: {source}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-950" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">FO/User</span>
              <select value={foUser} onChange={(event) => setFoUser(event.target.value)} className="focus-ring h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-950">
                <option>All</option>
              {rows.map((row) => <option key={row.username}>{row.username}</option>)}
              </select>
          </label>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>{['Username', 'Start Day', 'End Day', 'Status', 'Last seen', 'Battery', 'GPS points', 'Today KM', 'Raw GPS KM', 'Filtered GPS KM', 'Actual Travel KM', 'Route vs Actual', 'Rate/KM', 'Petrol'].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.username}>
                <td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">{row.username}<div className="text-xs font-medium text-slate-500">{row.display_name}</div></td>
                <td className="px-3 py-3">{formatDateTimeCell(row.start)}</td>
                <td className="px-3 py-3">{formatDateTimeCell(row.end)}</td>
                <td className="px-3 py-3"><StatusBadge status={row.status || 'Not started'} /></td>
                <td className="px-3 py-3">{formatDateTimeCell(row.lastSeen)}</td>
                <td className="px-3 py-3">{row.battery == null ? '-' : `${row.battery}%`}</td>
                <td className="px-3 py-3">{row.points || 0}</td>
                <td className="px-3 py-3">{formatKm(row.eligibleKm)}</td>
                <td className="px-3 py-3">{formatKm(row.rawGpsKm)}</td>
                <td className="px-3 py-3">{formatKm(row.filteredGpsKm)}</td>
                <td className="px-3 py-3">{formatKm(row.actualKm)}</td>
                <td className="px-3 py-3">{formatKm(Number(row.eligibleKm || 0) - Number(row.actualKm || 0))}</td>
                <td className="px-3 py-3">₹{row.rate || 4}</td>
                <td className="px-3 py-3 font-semibold">₹{Number(row.petrol || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const workflowStageOwners = {
  'Operations Review': 'Operations Team',
  'Coordinator Costing Review': 'Coordinator',
  'HR Validation': 'HR Reviewer',
  'Commercial Review': 'Commercial Reviewer',
  'Finance Review': 'Finance Reviewer',
};

const reviewerScopeMatrix = {
  'Operations Review': {
    editable: 6,
    viewOnly: 5,
    hidden: 4,
    rows: [
      { area: 'Tools / Equipment', access: 'Editable', count: 18 },
      { area: 'Operational Feasibility', access: 'Editable', count: 12 },
      { area: 'Site Readiness', access: 'Editable', count: 9 },
      { area: 'Commercial Costing', access: 'Hidden', count: 6 },
      { area: 'HR Costing', access: 'Hidden', count: 5 },
    ],
  },
  'Coordinator Costing Review': {
    editable: 5,
    viewOnly: 7,
    hidden: 3,
    rows: [
      { area: 'Manpower Consolidation', access: 'Editable', count: 14 },
      { area: 'Reliever Logic', access: 'Editable', count: 8 },
      { area: 'Zone Logic', access: 'Editable', count: 6 },
      { area: 'Operations Scope', access: 'View Only', count: 11 },
      { area: 'Finance Approval', access: 'Hidden', count: 3 },
    ],
  },
  'HR Validation': {
    editable: 5,
    viewOnly: 4,
    hidden: 6,
    rows: [
      { area: 'Manpower Wages', access: 'Editable', count: 16 },
      { area: 'Shift / Gender', access: 'Editable', count: 10 },
      { area: 'Uniform Logic', access: 'Editable', count: 7 },
      { area: 'Commercial Statement', access: 'Hidden', count: 6 },
      { area: 'Finance Approval', access: 'Hidden', count: 4 },
    ],
  },
  'Commercial Review': {
    editable: 4,
    viewOnly: 10,
    hidden: 1,
    rows: [
      { area: 'Pricing', access: 'Editable', count: 10 },
      { area: 'Margins', access: 'Editable', count: 8 },
      { area: 'Management Fee', access: 'Editable', count: 5 },
      { area: 'Assessment Summary', access: 'View Only', count: 15 },
      { area: 'Finance Approval', access: 'Hidden', count: 2 },
    ],
  },
  'Finance Review': {
    editable: 4,
    viewOnly: 9,
    hidden: 2,
    rows: [
      { area: 'Payment Terms', access: 'Editable', count: 8 },
      { area: 'Budget Feasibility', access: 'Editable', count: 7 },
      { area: 'Finance Remarks', access: 'Editable', count: 9 },
      { area: 'Commercial Costing', access: 'View Only', count: 12 },
      { area: 'Operations Inputs', access: 'View Only', count: 11 },
    ],
  },
};

const healthTone = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20',
  yellow: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20',
};

function roleScope(user) {
  if (['Admin', 'COO'].includes(user?.role)) return 'admin';
  if (['BD Head', 'BD Executive'].includes(user?.role)) return 'bd';
  if (isCommercialTeam(user)) return 'commercial';
  if (isFinanceTeam(user)) return 'finance';
  if (isHrReviewer(user)) return 'hr';
  if (isOperationsTeam(user)) return 'operations';
  if (isCoordinator(user)) return 'coordinator';
  return 'admin';
}

function reviewCount(siteVisits, stage, status = 'Pending') {
  return siteVisits.filter((visit) => (visit.reviewStatus?.[stage] || (visit.currentStage === stage ? 'Pending' : '')) === status).length;
}

function buildCommandCenterData({ user, leads, siteVisits, stage }) {
  const scope = roleScope(user);
  const pendingCommercial = reviewCount(siteVisits, 'Commercial Review');
  const pendingFinance = reviewCount(siteVisits, 'Finance Review');
  const pendingOperations = reviewCount(siteVisits, 'Operations Review');
  const pendingHr = reviewCount(siteVisits, 'HR Validation');
  const proposalsDue = leads.filter((lead) => ['Proposal', 'Proposal Due', 'Proposal Pending'].includes(lead.stage)).length;
  const converted = leads.filter((lead) => lead.stage === 'Converted').length;
  const pendingApprovals = pendingCommercial + pendingFinance + pendingOperations + pendingHr + reviewCount(siteVisits, 'Coordinator Costing Review');
  const siteVisitsToday = siteVisits.filter((visit) => ['Scheduled', 'Pending Review', 'Site Visit MOM Sent'].includes(visit.status)).length;
  const operationalVisits = stage ? reviewCount(siteVisits, stage) : pendingApprovals;
  const operationsFocus = scope === 'operations';

  const baseTodayOperations = [
    { label: 'Site Visits Today', value: siteVisitsToday, icon: CalendarCheck2, tone: 'blue' },
    { label: 'Approvals Pending', value: stage ? reviewCount(siteVisits, stage) : pendingApprovals, icon: Clock3, tone: 'amber' },
    { label: 'Proposals Due', value: proposalsDue, icon: FileText, tone: 'violet' },
    { label: 'Employee Check-ins', value: 0, icon: UserCheck, tone: 'green' },
    { label: 'Field Tasks Pending', value: operationsFocus ? operationalVisits : 0, icon: ClipboardList, tone: 'amber' },
    { label: 'Client Escalations', value: 0, icon: MessageSquareWarning, tone: 'red' },
  ];
  const todayOperationsByScope = {
    commercial: [
      { label: 'Commercial Reviews', value: pendingCommercial, icon: BriefcaseBusiness, tone: 'amber' },
      { label: 'Pricing Due', value: pendingCommercial, icon: FileText, tone: 'violet' },
      { label: 'Margin Exceptions', value: 0, icon: AlertTriangle, tone: 'red' },
      { label: 'Proposals Due', value: proposalsDue, icon: ClipboardList, tone: 'blue' },
      { label: 'Approved Today', value: siteVisits.filter((visit) => visit.reviewStatus?.['Commercial Review'] === 'Approved').length, icon: CheckCircle2, tone: 'green' },
      { label: 'Client Escalations', value: 0, icon: MessageSquareWarning, tone: 'red' },
    ],
    finance: [
      { label: 'Finance Approvals', value: pendingFinance, icon: Clock3, tone: 'amber' },
      { label: 'Proposal Value Queue', value: formatInr(0), icon: FileText, tone: 'blue' },
      { label: 'Payment Terms Due', value: pendingFinance, icon: ClipboardList, tone: 'violet' },
      { label: 'Budget Exceptions', value: 0, icon: AlertTriangle, tone: 'red' },
      { label: 'Approved Today', value: siteVisits.filter((visit) => visit.reviewStatus?.['Finance Review'] === 'Approved').length, icon: CheckCircle2, tone: 'green' },
      { label: 'Escalations', value: 0, icon: MessageSquareWarning, tone: 'amber' },
    ],
    hr: [
      { label: 'Manpower Reviews', value: pendingHr, icon: Users, tone: 'amber' },
      { label: 'Employee Check-ins', value: 0, icon: UserCheck, tone: 'green' },
      { label: 'Wage Validations', value: pendingHr, icon: ClipboardList, tone: 'blue' },
      { label: 'Shift Exceptions', value: 0, icon: AlertTriangle, tone: 'red' },
      { label: 'Uniform Checks', value: pendingHr, icon: FileText, tone: 'violet' },
      { label: 'Pending Escalations', value: 0, icon: MessageSquareWarning, tone: 'amber' },
    ],
  };
  const todayOperations = todayOperationsByScope[scope] || baseTodayOperations;

  const actions = [
    { label: 'Commercial reviews pending', count: pendingCommercial, priority: 'High', cta: 'Review', scope: ['admin', 'commercial'] },
    { label: 'Finance approvals pending', count: pendingFinance, priority: 'High', cta: 'Review', scope: ['admin', 'finance'] },
    { label: 'Site visits overdue', count: siteVisits.filter((visit) => visit.status === 'Overdue').length, priority: 'High', cta: 'Assign', scope: ['admin', 'bd', 'operations'] },
    { label: 'Proposals not sent', count: proposalsDue, priority: 'Medium', cta: 'Open', scope: ['admin', 'bd', 'commercial', 'finance'] },
    { label: 'Leads stuck in same stage', count: leads.filter((lead) => ['Contacted', 'MOM Pending'].includes(lead.stage)).length, priority: 'Low', cta: 'Assign', scope: ['admin', 'bd'] },
    { label: 'Manpower validation pending', count: pendingHr, priority: 'High', cta: 'Review', scope: ['admin', 'hr', 'coordinator'] },
  ].filter((item) => item.scope.includes(scope) && item.count > 0).slice(0, 6);

  const recentActivity = [
    ...leads.slice(0, 3).map((lead) => ({ event: lead.stage || 'Lead updated', detail: lead.company, time: 'Recent' })),
    ...siteVisits.slice(0, 3).map((visit) => ({ event: visit.currentStage || visit.status || 'Assessment updated', detail: visit.company, time: 'Recent' })),
  ].slice(0, 6);

  const operationalHealth = [
    { label: 'Proposal TAT', value: '-', tone: 'green', helper: 'Pending data' },
    { label: 'Approval TAT', value: '-', tone: pendingApprovals > 8 ? 'yellow' : 'green', helper: 'Pending data' },
    { label: 'Site Visit Completion', value: `${siteVisits.length ? Math.round((siteVisits.filter((visit) => ['Completed', 'Proposal Sent', 'Returned to BD'].includes(visit.status)).length / siteVisits.length) * 100) : 0}%`, tone: 'green', helper: 'Current records' },
    { label: 'Lead Conversion', value: `${leads.length ? Math.round((converted / leads.length) * 100) : 0}%`, tone: 'yellow', helper: 'Current records' },
    { label: 'Attendance Compliance', value: '-', tone: 'green', helper: 'Pending data' },
    { label: 'Pending Escalations', value: 0, tone: operationsFocus ? 'yellow' : 'green', helper: 'Current records' },
  ];

  return { todayOperations, actions, recentActivity, operationalHealth };
}

function ChartFrame({ children, height = 'h-56' }) {
  return <div className={`${height} min-w-0 overflow-hidden rounded-2xl bg-slate-50 p-3 dark:bg-slate-950/55`}>{children}</div>;
}

function businessAppliesToState(business, state) {
  if (business === 'All Businesses') return true;
  return businessStateCoverage[business]?.includes(state);
}

function scaleOperationRow(row, business) {
  if (business === 'All Businesses') return row;
  const weight = businessWeights[business] || 0.18;
  const statePenalty = row.status === 'Critical' ? 1.12 : row.status === 'Warning' ? 1.06 : 1;
  const scaled = {
    ...row,
    activeSites: Math.max(3, Math.round(row.activeSites * weight)),
    officers: Math.max(1, Math.round(row.officers * weight)),
    visits: Math.max(1, Math.round(row.visits * weight)),
    tickets: Math.max(0, Math.round(row.tickets * weight * statePenalty)),
    tasks: Math.max(1, Math.round(row.tasks * weight * statePenalty)),
    sla: Math.max(72, Math.min(99, Math.round(row.sla - (1 - weight) * 4 + (business === 'Reliance Retail' ? 2 : 0)))),
  };
  return {
    ...scaled,
    attendance: Math.max(72, Math.min(99, Math.round(row.attendance - (1 - weight) * 3 + (business === 'TN Government' ? 2 : 0)))),
    status: scaled.sla < 86 || scaled.attendance < 84 || scaled.tickets > 8 ? 'Critical' : scaled.sla < 92 || scaled.attendance < 89 ? 'Warning' : 'Healthy',
  };
}

function filterOperationSummary(business, state) {
  return stateOperationsSummary
    .filter((row) => businessAppliesToState(business, row.state))
    .filter((row) => state === 'All States' || row.state === state)
    .map((row) => scaleOperationRow(row, business));
}

function sumOperationRows(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function averageOperationRows(rows, key) {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((total, row) => total + Number(row[key] || 0), 0) / rows.length);
}

function buildOperationsKpis(rows) {
  const activeSites = sumOperationRows(rows, 'activeSites');
  const officers = sumOperationRows(rows, 'officers');
  const attendance = averageOperationRows(rows, 'attendance');
  const visits = sumOperationRows(rows, 'visits');
  const tickets = sumOperationRows(rows, 'tickets');
  const tasks = sumOperationRows(rows, 'tasks');
  const criticalTickets = rows.filter((row) => row.status === 'Critical').reduce((total, row) => total + row.tickets, 0);
  const overdue = rows.filter((row) => row.status !== 'Healthy').reduce((total, row) => total + Math.max(1, Math.round(row.tasks * 0.1)), 0);
  const avgResolutionHours = Math.max(2.1, Math.min(5.8, 2.4 + tickets / Math.max(activeSites, 1) * 4 + overdue / 90));

  const valueById = {
    activeSites,
    fieldOfficersActive: officers,
    attendanceCaptured: `${attendance}%`,
    siteVisitsCompleted: visits,
    openTickets: tickets,
    pendingTasks: tasks,
    overdueTasks: overdue,
    avgResolutionTime: `${Math.floor(avgResolutionHours)}h ${Math.round((avgResolutionHours % 1) * 60)}m`,
  };
  const changeById = {
    activeSites: `Across ${rows.length || 0} filtered regions`,
    fieldOfficersActive: 'Filtered live field coverage',
    attendanceCaptured: `${Math.max(1200, activeSites * 84).toLocaleString('en-IN')} punches synced`,
    siteVisitsCompleted: 'Filtered operational visits',
    openTickets: `${criticalTickets || Math.max(1, Math.round(tickets * 0.16))} high priority`,
    pendingTasks: 'Filtered action queue',
    overdueTasks: 'Needs escalation',
    avgResolutionTime: 'Filtered facility tickets',
  };

  return existingOperationsKpis.map((kpi) => ({
    ...kpi,
    value: String(valueById[kpi.id] ?? kpi.value),
    change: changeById[kpi.id] || kpi.change,
  }));
}

function buildTaskDistribution(rows) {
  const pending = sumOperationRows(rows, 'tasks');
  const overdue = rows.filter((row) => row.status !== 'Healthy').reduce((total, row) => total + Math.max(1, Math.round(row.tasks * 0.1)), 0);
  return [
    { name: 'Completed', value: Math.max(20, Math.round(sumOperationRows(rows, 'visits') * 2.4)) },
    { name: 'Pending', value: pending },
    { name: 'Overdue', value: overdue },
  ];
}

function buildSeverityData(rows) {
  return [
    { severity: 'High', count: rows.filter((row) => row.status === 'Critical').reduce((total, row) => total + Math.max(1, Math.round(row.tasks * 0.08)), 0) },
    { severity: 'Medium', count: rows.filter((row) => row.status === 'Warning').reduce((total, row) => total + Math.max(1, Math.round(row.tasks * 0.12)), 0) },
    { severity: 'Low', count: rows.filter((row) => row.status === 'Healthy').reduce((total, row) => total + Math.max(1, Math.round(row.tasks * 0.04)), 0) },
  ];
}

function buildResolutionData(rows) {
  return rows.map((row) => ({
    state: row.state,
    hours: Number((2.2 + row.tickets / Math.max(row.activeSites, 1) * 7 + (100 - row.sla) / 18).toFixed(2)),
  }));
}

function buildBusinessSnapshot(business, state) {
  const businesses = business === 'All Businesses' ? businessFilterOptions.slice(1) : [business];
  return businesses.map((name) => {
    const rows = filterOperationSummary(name, state);
    const attendance = averageOperationRows(rows, 'attendance');
    const escalations = rows.reduce((total, row) => total + (row.status === 'Critical' ? row.tickets : Math.round(row.tickets * 0.25)), 0);
    const visits = sumOperationRows(rows, 'visits');
    const sla = averageOperationRows(rows, 'sla');
    return {
      id: name,
      business: name,
      attendance: `${attendance || 0}%`,
      escalations,
      siteVisits: visits,
      slaHealth: `${sla || 0}%`,
      status: sla < 88 || escalations > 8 ? 'Critical' : sla < 93 || attendance < 89 ? 'Warning' : 'Healthy',
    };
  });
}

function operationsStatus(rows) {
  if (!rows.length) return { label: 'Attention Required', tone: 'yellow' };
  const critical = rows.filter((row) => row.status === 'Critical').length;
  const warning = rows.filter((row) => row.status === 'Warning').length;
  if (critical) return { label: 'Critical Escalations', tone: 'red' };
  if (warning) return { label: 'Attention Required', tone: 'yellow' };
  return { label: 'Stable Operations', tone: 'green' };
}

function filterRowsByState(rows, summaryRows) {
  const allowedStates = new Set(summaryRows.map((row) => row.state));
  return rows.filter((row) => !row.state || allowedStates.has(row.state));
}

function buildFilteredOperationsDetailSections(summaryRows, business, state) {
  const suffix = `${business === 'All Businesses' ? 'All businesses' : business} / ${state === 'All States' ? 'All states' : state}`;
  return Object.fromEntries(Object.entries(operationsDetailSections).map(([key, detail]) => {
    const rows = key === 'attendanceCaptured'
      ? summaryRows.map((item) => ({
          id: item.id,
          state: item.state,
          attendance: `${item.attendance}%`,
          captured: item.activeSites * 84,
          missing: Math.max(4, 100 - item.attendance),
          exceptions: item.status === 'Healthy' ? 'Low' : 'Review needed',
          status: item.status,
        }))
      : filterRowsByState(detail.rows, summaryRows);

    return [key, { ...detail, description: `${detail.description} Filter: ${suffix}.`, rows }];
  }));
}

function pipelineBusinessForLead(lead) {
  const text = `${lead.company || ''} ${lead.industry || ''} ${lead.source || ''}`.toLowerCase();
  if (text.includes('retail') || text.includes('mall')) return 'Retail';
  if (text.includes('hospital') || text.includes('med') || text.includes('health')) return 'Healthcare';
  if (text.includes('tech') || text.includes('park') || text.includes('tower')) return 'IT / Parks';
  if (text.includes('government') || text.includes('admin') || text.includes('port')) return 'Government';
  return 'Private Clients';
}

function pipelineRegionForLead(lead) {
  const state = lead.state || lead.region || lead.city || '';
  if (state.includes('Andhra')) return 'Andhra Pradesh';
  return ['Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana'].find((region) => state.includes(region)) || 'Tamil Nadu';
}

function filterPipelineLeads(leads, { business, region, owner }) {
  return leads.filter((lead) => {
    const businessMatch = business === 'All Businesses' || pipelineBusinessForLead(lead) === business;
    const regionMatch = region === 'All Regions' || pipelineRegionForLead(lead) === region;
    const ownerMatch = owner === 'All BD Owners' || lead.assigned_bd_executive === owner || lead.executive === owner;
    return businessMatch && regionMatch && ownerMatch;
  });
}

function stageCount(leads, siteVisits, matcher, fallback) {
  return matcher(leads, siteVisits) || Number(fallback || 0);
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function proposalValueForRecord(record) {
  return numericValue(
    record?.proposalValue
      || record?.proposal_value
      || record?.commercial_value
      || record?.contract_value
      || record?.proposal?.value
      || record?.survey?.commercial?.proposalValue
      || record?.survey?.commercial?.proposal_value
      || record?.survey?.commercial?.contractValue
      || record?.survey?.commercialStatementValue,
  );
}

function recordDate(record) {
  const value = record?.proposalSentAt
    || record?.proposal_sent_at
    || record?.updated_at
    || record?.created_at
    || record?.lastApprovalAt
    || record?.converted_at
    || record?.date;
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function stagePercent(count, total) {
  if (!total) return 0;
  return Math.round((Number(count || 0) / total) * 100);
}

function buildProposalTrend(leads, siteVisits) {
  const records = [...leads, ...siteVisits];
  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleString('en-IN', { month: 'short' }),
      pipelineValue: 0,
      approvedValue: 0,
      convertedValue: 0,
    };
  });
  const lookup = Object.fromEntries(monthKeys.map((row) => [row.key, row]));

  records.forEach((record) => {
    const value = proposalValueForRecord(record);
    if (!value) return;
    const date = recordDate(record);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!lookup[key]) return;
    const status = record.stage || record.status || record.currentStage || '';
    lookup[key].pipelineValue += value;
    if (String(status).includes('Approved') || record.reviewStatus?.['Finance Review'] === 'Approved') lookup[key].approvedValue += value;
    if (String(status).includes('Converted') || String(status).includes('Proposal Sent')) lookup[key].convertedValue += value;
  });

  return monthKeys;
}

function buildApprovalBottleneckData(siteVisits) {
  const stageRows = [
    ['Commercial', 'Commercial Review'],
    ['Finance', 'Finance Review'],
    ['HR', 'HR Validation'],
  ];

  return stageRows.map(([label, stage]) => ({
    stage: label,
    Pending: siteVisits.filter((visit) => (visit.reviewStatus?.[stage] || (visit.currentStage === stage ? 'Pending' : '')) === 'Pending').length,
    Rework: siteVisits.filter((visit) => visit.reviewStatus?.[stage] === 'Rework Requested').length,
    Delayed: siteVisits.filter((visit) => (visit.currentStage === stage || visit.reviewStatus?.[stage] === 'Pending') && (visit.slaStatus === 'Delayed' || visit.status === 'Overdue' || visit.priority === 'High')).length,
  }));
}

function buildPipelineCommandData(leads, siteVisits, bdRows) {
  const openLeads = leads.filter((lead) => !['Converted', 'Lost'].includes(lead.stage));
  const commercialPending = leads.filter((lead) => lead.stage === 'Commercial Review').length + siteVisits.filter((visit) => (visit.reviewStatus?.['Commercial Review'] || (visit.currentStage === 'Commercial Review' ? 'Pending' : '')) === 'Pending').length;
  const financePending = siteVisits.filter((visit) => (visit.reviewStatus?.['Finance Review'] || (visit.currentStage === 'Finance Review' ? 'Pending' : '')) === 'Pending').length;
  const hrPending = siteVisits.filter((visit) => (visit.reviewStatus?.['HR Validation'] || (visit.currentStage === 'HR Validation' ? 'Pending' : '')) === 'Pending').length;
  const approvalPending = commercialPending + financePending + hrPending + leads.filter((lead) => ['Approval Pending', 'BD Team Review', 'COO Approval'].includes(lead.stage)).length;
  const proposals = leads.filter((lead) => lead.stage === 'Proposal Sent').length + siteVisits.filter((visit) => ['Proposal Generated', 'Proposal Sent'].includes(visit.status) || visit.proposal).length;
  const converted = leads.filter((lead) => lead.stage === 'Converted' || lead.status === 'Converted to Assessment').length;
  const siteVisitCount = siteVisits.length || leads.filter((lead) => lead.stage === 'Site Visit Scheduled').length;
  const estimationCount = siteVisits.filter((visit) => ['Scheduled', 'Site Visit MOM Created', 'Site Visit MOM Sent', 'Pending Review'].includes(visit.status)).length;
  const proposalValue = [...leads, ...siteVisits].reduce((total, record) => total + proposalValueForRecord(record), 0);
  const totalLeadBase = Math.max(leads.length, 1);
  const conversionPercent = leads.length ? Math.round((converted / totalLeadBase) * 100) : 0;

  const kpis = [
    { id: 'openLeads', title: 'Open Leads', value: stageCount(leads, siteVisits, () => openLeads.length, 0), icon: BriefcaseBusiness, tone: 'blue' },
    { id: 'siteVisitsPlanned', title: 'Site Visits Scheduled', value: stageCount(leads, siteVisits, () => siteVisitCount, 0), icon: CalendarCheck2, tone: 'green' },
    { id: 'estimationsPending', title: 'Estimations Pending', value: stageCount(leads, siteVisits, () => estimationCount, 0), tone: 'violet' },
    { id: 'proposalValue', title: 'Proposal Value', value: formatInr(proposalValue), icon: TrendingUp, tone: 'blue' },
    { id: 'conversion', title: 'Conversion %', value: `${conversionPercent}%`, icon: CheckCircle2, tone: 'amber' },
    { id: 'approvalPending', title: 'Pending Approvals', value: stageCount(leads, siteVisits, () => approvalPending, 0), icon: Clock3, tone: 'red' },
  ];

  const leadStageCount = stageCount(leads, siteVisits, () => openLeads.length, 0);
  const contactedCount = stageCount(leads, siteVisits, (items) => items.filter((lead) => ['Contacted', 'In Discussion'].includes(lead.stage)).length, 0);
  const proposalCount = stageCount(leads, siteVisits, () => proposals, 0);
  const flow = [
    { stage: 'Lead', count: leadStageCount, conversion: stagePercent(leadStageCount, totalLeadBase), tone: 'blue' },
    { stage: 'Contacted', count: contactedCount, conversion: stagePercent(contactedCount, totalLeadBase), tone: 'slate' },
    { stage: 'Site Visit', count: siteVisitCount, conversion: stagePercent(siteVisitCount, totalLeadBase), tone: 'green' },
    { stage: 'Estimation', count: estimationCount, conversion: stagePercent(estimationCount, totalLeadBase), tone: 'violet' },
    { stage: 'Commercial', count: commercialPending, conversion: stagePercent(commercialPending, totalLeadBase), tone: 'amber' },
    { stage: 'Finance', count: financePending, conversion: stagePercent(financePending, totalLeadBase), tone: 'red' },
    { stage: 'Proposal', count: proposalCount, conversion: stagePercent(proposalCount, totalLeadBase), tone: 'blue' },
    { stage: 'Converted', count: converted, conversion: conversionPercent, tone: 'green' },
  ];

  const actions = [
    { label: 'Estimations pending', count: estimationCount, priority: 'High', aging: 'Current', owner: 'BD Team', stage: 'Estimation' },
    { label: 'Approvals delayed', count: approvalPending, priority: 'High', aging: 'Current', owner: 'Review Teams', stage: 'Approval' },
    { label: 'Overdue site visits', count: siteVisits.filter((visit) => visit.status === 'Overdue').length, priority: 'Medium', aging: 'Overdue', owner: 'BD Team', stage: 'Site Visit' },
    { label: 'Rework returned', count: siteVisits.filter((visit) => Object.values(visit.reviewStatus || {}).includes('Rework Requested')).length, priority: 'Medium', aging: 'Needs action', owner: 'BD Team', stage: 'Rework' },
  ].filter((item) => item.count > 0);

  const activity = [
    ...leads.slice(0, 5).map((lead) => ({ event: lead.stage || 'Lead updated', client: lead.company, time: 'Recent', status: lead.status || lead.stage || 'Updated', type: 'lead' })),
    ...siteVisits.slice(0, 5).map((visit) => ({ event: visit.currentStage || visit.status || 'Assessment updated', client: visit.company, time: 'Recent', status: visit.approvalStatus || visit.status || 'Updated', type: 'site' })),
  ];

  const performance = bdRows.map((row) => ({
    id: row.id,
    executive: row.executive,
    leads: row.totalLeads || 0,
    conversion: row.totalLeads ? Math.round((row.siteVisitsScheduled / row.totalLeads) * 100) : 0,
    pending: row.commercialPending + row.financePending + row.cooPending,
    revenue: (row.siteVisitsScheduled || 0) * 1850000,
  }));

  return {
    kpis,
    flow,
    actions,
    activity,
    performance,
    proposalTrend: buildProposalTrend(leads, siteVisits),
    approvalBottlenecks: buildApprovalBottleneckData(siteVisits),
    proposalValue,
  };
}

function compactTone(tone) {
  return {
    blue: 'bg-qpms-50 text-qpms-700 ring-qpms-200 dark:bg-qpms-500/15 dark:text-qpms-300 dark:ring-qpms-500/20',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/20',
    red: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20',
  }[tone] || 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700';
}

function priorityClass(priority) {
  return {
    High: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/25',
    Medium: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25',
    Low: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25',
  }[priority];
}

function QuickActionBar({ user }) {
  if (isDemoMode) return null;
  const scope = roleScope(user);
  const actions = [
    { label: 'New Lead', icon: BriefcaseBusiness, scopes: ['admin', 'bd'] },
    { label: 'Schedule Site Visit', icon: CalendarCheck2, scopes: ['admin', 'bd', 'operations'] },
    { label: 'Generate Proposal', icon: FileText, scopes: ['admin', 'bd', 'commercial', 'finance'] },
    { label: 'Open Approvals', icon: CheckCircle2, scopes: ['admin', 'commercial', 'finance', 'operations', 'hr', 'coordinator'] },
    { label: 'Add Employee', icon: UserPlus, scopes: ['admin', 'hr'] },
    { label: 'Export Report', icon: Download, scopes: ['admin', 'bd', 'commercial', 'finance', 'operations', 'hr', 'coordinator'] },
  ].filter((action) => action.scopes.includes(scope));

  return (
    <section className="enterprise-card flex flex-wrap items-center gap-2 p-3 sm:p-4">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-qpms-200 hover:bg-qpms-50 hover:text-qpms-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-qpms-500/40 dark:hover:bg-qpms-500/10"
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
    </section>
  );
}

function TodayOperations({ items }) {
  return (
    <section className="enterprise-card-compact p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold leading-5 text-slate-950 dark:text-white">Today's Operations</h2>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {items.map((item) => {
          const Icon = item.icon;
          return (
          <div key={item.label} className="flex min-h-16 items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold uppercase leading-4 tracking-wide text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="mt-0.5 text-lg font-semibold leading-none text-slate-950 dark:text-white">{item.value}</p>
              </div>
              <div className={`shrink-0 rounded-lg p-1.5 ring-1 ${compactTone(item.tone)}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActionCenter({ actions }) {
  return (
    <section className="enterprise-card-compact p-4">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold leading-5 text-slate-950 dark:text-white">Pending Alerts</h2>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {actions.length ? actions.map((action) => (
          <div key={action.label} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold leading-5 text-slate-950 dark:text-white">{action.label}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${priorityClass(action.priority)}`}>{action.priority}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{action.count} records need attention</p>
            </div>
            <button type="button" className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg bg-qpms-600 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-qpms-700">
              {action.cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )) : (
          <div className="rounded-xl border border-slate-100 bg-white px-3 py-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            No pending alerts.
          </div>
        )}
      </div>
    </section>
  );
}

function RecentActivityFeed({ items }) {
  return (
    <section className="enterprise-card-compact p-4">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold leading-5 text-slate-950 dark:text-white">Recent Activity Feed</h2>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {items.length ? items.map((item) => (
          <div key={`${item.event}-${item.time}`} className="flex gap-2.5">
            <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-qpms-500 shadow-[0_0_0_3px_rgba(79,130,251,0.12)]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-slate-950 dark:text-white">{item.event}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.time}</p>
            </div>
          </div>
        )) : (
          <div className="rounded-xl border border-slate-100 bg-white px-3 py-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            No recent workflow activity.
          </div>
        )}
      </div>
    </section>
  );
}

function OperationalHealth({ items }) {
  return (
    <ChartCard title="Operational Health / SLA Insights">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.label} className={`rounded-xl p-3 ring-1 ${healthTone[item.tone]}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase leading-4 tracking-wide">{item.label}</p>
                <p className="mt-1 text-xl font-semibold leading-none">{item.value}</p>
                <p className="mt-1 text-[11px] font-semibold opacity-80">{item.helper}</p>
              </div>
              <TimerReset className="h-4 w-4 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

function CommandCenterOverview({ user, leads, siteVisits, stage }) {
  const data = useMemo(() => buildCommandCenterData({ user, leads, siteVisits, stage }), [user, leads, siteVisits, stage]);
  const showQuickActions = roleScope(user) === 'bd';

  return (
    <div className="space-y-4">
      {showQuickActions ? <QuickActionBar user={user} /> : null}
      <TodayOperations items={data.todayOperations} />
      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <ActionCenter actions={data.actions} />
        <RecentActivityFeed items={data.recentActivity} />
      </section>
      <OperationalHealth items={data.operationalHealth} />
    </div>
  );
}

function getDetailColumns(columns) {
  return columns.map((column) => {
    if (['status', 'reviewStatus'].includes(column.key)) {
      return { ...column, render: (row) => <StatusBadge status={row[column.key]} /> };
    }

    return column;
  });
}

function OperationsDrilldownChart({ sectionId, summaryRows = stateOperationsSummary }) {
  const taskDistribution = buildTaskDistribution(summaryRows);
  const severityData = buildSeverityData(summaryRows);
  const resolutionData = buildResolutionData(summaryRows);
  const chartBySection = {
    activeSites: (
      <BarChart data={summaryRows}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="activeSites" fill="#2444a4" radius={[10, 10, 0, 0]} name="Active Sites" />
      </BarChart>
    ),
    fieldOfficersActive: (
      <BarChart data={summaryRows}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="officers" fill="#10b981" radius={[10, 10, 0, 0]} name="Field Officers" />
      </BarChart>
    ),
    attendanceCaptured: (
      <ComposedChart data={summaryRows}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="attendance" fill="#10b981" radius={[10, 10, 0, 0]} name="Attendance %" />
        <Line type="monotone" dataKey="visits" stroke="#2444a4" strokeWidth={3} name="Site Visits" />
      </ComposedChart>
    ),
    siteVisitsCompleted: (
      <LineChart data={siteVisitTrend}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={3} name="Completed Visits" />
        <Line type="monotone" dataKey="visits" stroke="#2444a4" strokeWidth={3} name="Planned Visits" />
      </LineChart>
    ),
    openTickets: (
      <BarChart data={summaryRows}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="tickets" fill="#f59e0b" radius={[10, 10, 0, 0]} name="Open Tickets" />
      </BarChart>
    ),
    pendingTasks: (
      <PieChart>
        <Pie data={taskDistribution} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
          {taskDistribution.map((entry, index) => (
            <Cell key={entry.name} fill={taskColors[index]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    ),
    overdueTasks: (
      <BarChart data={severityData}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="severity" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="count" fill="#ef4444" radius={[10, 10, 0, 0]} name="Overdue Tasks" />
      </BarChart>
    ),
    avgResolutionTime: (
      <BarChart data={resolutionData}>
        <CartesianGrid stroke={chartGrid} vertical={false} />
        <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="hours" fill="#f59e0b" radius={[10, 10, 0, 0]} name="Avg Hours" />
      </BarChart>
    ),
  };

  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height="100%">
        {chartBySection[sectionId]}
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function DashboardDetailPanel({ sectionId, sections, renderChart }) {
  const [query, setQuery] = useState('');
  const detail = sections[sectionId];

  if (!detail) {
    return null;
  }

  const normalizedQuery = query.trim().toLowerCase();
  const rows = normalizedQuery
    ? detail.rows.filter((row) =>
        Object.values(row).some((value) => String(value).toLowerCase().includes(normalizedQuery)),
      )
    : detail.rows;
  const summaryTotal = detail.amountKey
    ? detail.rows.reduce((total, row) => total + Number(row[detail.amountKey] || 0), 0)
    : null;

  return (
    <div key={sectionId} className="animate-[login-fade-up_220ms_ease-out]">
      <ChartCard
        title={detail.title}
        description={detail.description}
        action={
          <div className="relative w-full min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${detail.title.toLowerCase()}...`}
              className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            />
          </div>
        }
      >
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          <span>Dashboard</span>
          <span>/</span>
          <span className="text-qpms-600 dark:text-qpms-300">{detail.title}</span>
        </div>

        {detail.summaryLabel ? (
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-qpms-100 bg-qpms-50 p-4 dark:border-qpms-500/20 dark:bg-qpms-500/10">
              <p className="text-xs font-semibold uppercase text-qpms-700 dark:text-qpms-200">{detail.summaryLabel}</p>
              <p className="mt-2 text-2xl font-semibold leading-none text-slate-950 dark:text-white">
                {formatInr(summaryTotal)}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mb-5">
          {renderChart(sectionId)}
        </div>

        {rows.length ? (
          <DataTable columns={getDetailColumns(detail.columns)} rows={rows} embedded />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-950/55">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No matching records found</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Try a different company, status, owner, or stage.</p>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

function PipelineFilterBar({ filters, onChange, ownerOptions }) {
  const fields = [
    ['Business Filter', 'business', pipelineBusinessOptions],
    ['Region Filter', 'region', pipelineRegionOptions],
    ['BD Owner Filter', 'owner', ownerOptions],
    ['Date Range Filter', 'dateRange', dateRangeOptions],
  ];

  return (
    <section className="enterprise-card-compact p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {fields.map(([label, key, options]) => (
          <label key={key} className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
            <select
              value={filters[key]}
              onChange={(event) => onChange(key, event.target.value)}
              className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              {options.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

function PipelineKpiStrip({ items }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {items.map((item) => {
        const Icon = item.icon || ClipboardList;
        return (
          <button
            key={item.id}
            type="button"
            className="focus-ring group flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-qpms-200 hover:shadow-lg hover:shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-qpms-500/35 dark:hover:shadow-none"
          >
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.title}</p>
              <p className="mt-1 truncate text-xl font-semibold leading-none text-slate-950 dark:text-white">{item.value}</p>
            </div>
            <span className={`shrink-0 rounded-xl p-2 ring-1 transition group-hover:scale-105 ${compactTone(item.tone)}`}>
              <Icon className="h-4 w-4" />
            </span>
          </button>
        );
      })}
    </section>
  );
}

function PipelineConversionFunnel({ stages }) {
  return (
    <section className="enterprise-card-compact p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-slate-950 dark:text-white">Pipeline Conversion Funnel</h2>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[1040px] grid-cols-8 gap-2">
          {stages.map((stage, index) => (
            <button
              key={stage.stage}
              type="button"
              className="focus-ring relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-qpms-200 hover:bg-white dark:border-slate-800 dark:bg-slate-950/55 dark:hover:border-qpms-500/35"
            >
              {index < stages.length - 1 ? <span className="absolute right-0 top-1/2 h-8 w-px -translate-y-1/2 bg-slate-200 dark:bg-slate-800" /> : null}
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold text-slate-900 dark:text-white">{stage.stage}</p>
                <span className={`h-2.5 w-2.5 rounded-full ${stage.tone === 'green' ? 'bg-emerald-500' : stage.tone === 'amber' ? 'bg-amber-500' : stage.tone === 'red' ? 'bg-rose-500' : stage.tone === 'violet' ? 'bg-violet-500' : 'bg-qpms-500'}`} />
              </div>
              <p className="mt-3 text-2xl font-semibold leading-none text-slate-950 dark:text-white">{stage.count}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-qpms-600" style={{ width: `${Math.min(100, stage.conversion)}%` }} />
              </div>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{stage.conversion}% conversion</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProposalValueTrend({ data }) {
  return (
    <ChartCard
      title="Proposal Value Trend"
      action={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Monthly</span>}
    >
      <ChartFrame height="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pipelineValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2444a4" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#2444a4" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="approvedValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chartGrid} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} tickFormatter={(value) => `₹${Math.round(value / 100000)}L`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatInr(value)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="pipelineValue" stroke="#2444a4" strokeWidth={2.5} fill="url(#pipelineValue)" name="Pipeline Value" />
            <Area type="monotone" dataKey="approvedValue" stroke="#10b981" strokeWidth={2.5} fill="url(#approvedValue)" name="Approved Value" />
            <Line type="monotone" dataKey="convertedValue" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} name="Converted Value" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </ChartCard>
  );
}

function ApprovalBottleneckChart({ data }) {
  return (
    <ChartCard title="Approval Bottleneck Chart">
      <ChartFrame height="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke={chartGrid} vertical={false} />
            <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Pending" stackId="approval" fill="#2444a4" radius={[8, 8, 0, 0]} />
            <Bar dataKey="Rework" stackId="approval" fill="#f59e0b" radius={[8, 8, 0, 0]} />
            <Bar dataKey="Delayed" stackId="approval" fill="#ef4444" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </ChartCard>
  );
}

function PipelineActionActivity({ actions, activity }) {
  return (
    <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="enterprise-card-compact p-4">
        <div className="mb-3">
          <h2 className="text-[16px] font-semibold text-slate-950 dark:text-white">Pending Actions</h2>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {actions.length ? actions.map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 transition hover:border-qpms-200 hover:bg-white dark:border-slate-800 dark:bg-slate-950/55">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">{item.count} {item.label}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${priorityClass(item.priority)}`}>{item.priority}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800">{item.stage}</span>
                  </div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <span>Owner: {item.owner}</span>
                <span className="text-right">Aging: {item.aging}</span>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-400">
              No pending pipeline actions.
            </div>
          )}
        </div>
      </div>

      <div className="enterprise-card-compact p-4">
        <div className="mb-3">
          <h2 className="text-[16px] font-semibold text-slate-950 dark:text-white">Recent Pipeline Activity</h2>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {activity.length ? activity.map((item) => (
            <div key={`${item.event}-${item.client}-${item.time}`} className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/55">
              <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ${item.type === 'site' ? compactTone('green') : compactTone('blue')}`}>
                {item.type === 'site' ? <CalendarCheck2 className="h-4 w-4" /> : <BriefcaseBusiness className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold leading-5 text-slate-950 dark:text-white">{item.event}</p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{item.client || 'Client pending'}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.time}</p>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-400">
              No recent pipeline activity.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BdPerformanceLeaderboard({ rows }) {
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1);
  return (
    <ChartCard title="BD Team Performance">
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/55">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{row.executive}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{row.leads} leads / {row.pending} pending</p>
              </div>
              <div className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300 md:min-w-72">
                <div className="flex justify-between"><span>Conversion</span><span>{row.conversion}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-qpms-600" style={{ width: `${Math.min(100, row.conversion)}%` }} />
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{formatInr(row.revenue)}</p>
                <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.round((row.revenue / maxRevenue) * 100))}%` }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

function NewBusinessPipeline({ visibleLeads, visibleSiteVisits, user }) {
  const [filters, setFilters] = useState({
    business: 'All Businesses',
    region: 'All Regions',
    owner: 'All BD Owners',
    dateRange: 'This Month',
  });
  const ownerOptions = useMemo(
    () => ['All BD Owners', ...bdExecutives.map((executive) => executive.name)],
    [],
  );
  const bdTeamOverview = useMemo(
    () =>
      bdExecutives.map((executive) => {
        const executiveLeads = visibleLeads.filter((lead) => lead.assigned_bd_email === executive.email || lead.assigned_bd_executive === executive.name);
        const executiveVisits = visibleSiteVisits.filter((visit) => visit.assigned_bd_email === executive.email || visit.assigned_bd_executive === executive.name);
        return {
          id: executive.id,
          executive: executive.name,
          totalLeads: executiveLeads.length,
          leadMomSent: executiveLeads.filter((lead) => ['Site Visit Scheduled', 'Lead MOM Sent'].includes(lead.stage) || lead.mom?.sent).length,
          siteVisitsScheduled: executiveVisits.length,
          commercialPending: executiveLeads.filter((lead) => lead.stage === 'Commercial Review').length + executiveVisits.filter((visit) => visit.currentStage === 'Commercial Review').length,
          financePending: executiveLeads.filter((lead) => lead.stage === 'Finance Validation').length,
          cooPending: executiveLeads.filter((lead) => lead.pendingWith === 'COO' || lead.stage === 'COO Approval').length,
        };
      }),
    [visibleLeads, visibleSiteVisits],
  );
  const filteredLeads = useMemo(() => filterPipelineLeads(visibleLeads, filters), [visibleLeads, filters]);
  const filteredSiteVisits = useMemo(
    () => visibleSiteVisits.filter((visit) => {
      const ownerMatch = filters.owner === 'All BD Owners' || visit.assigned_bd_executive === filters.owner;
      const regionMatch = filters.region === 'All Regions' || (visit.state || visit.city || '').includes(filters.region);
      const businessMatch = filters.business === 'All Businesses' || pipelineBusinessForLead(visit) === filters.business;
      return ownerMatch && regionMatch && businessMatch;
    }),
    [visibleSiteVisits, filters],
  );
  const pipelineData = useMemo(
    () => buildPipelineCommandData(filteredLeads, filteredSiteVisits, bdTeamOverview),
    [filteredLeads, filteredSiteVisits, bdTeamOverview],
  );

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <PipelineFilterBar filters={filters} onChange={updateFilter} ownerOptions={ownerOptions} />

      <PipelineKpiStrip items={pipelineData.kpis} />
      <PipelineConversionFunnel stages={pipelineData.flow} />
      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <ProposalValueTrend data={pipelineData.proposalTrend} />
        <ApprovalBottleneckChart data={pipelineData.approvalBottlenecks} />
      </section>
      <PipelineActionActivity actions={pipelineData.actions} activity={pipelineData.activity} />

      {['Admin', 'BD Head'].includes(user?.role) ? (
        <BdPerformanceLeaderboard rows={pipelineData.performance} />
      ) : null}
    </div>
  );
}

function ExecutiveOperationsCommandCenter({ leads, siteVisits }) {
  const [region, setRegion] = useState('All States');
  const operationsRows = useMemo(() => filterOperationSummary('All Businesses', region), [region]);
  const operationsKpis = useMemo(() => buildOperationsKpis(operationsRows), [operationsRows]);
  const pipeline = useMemo(() => buildPipelineCommandData(leads, siteVisits, []), [leads, siteVisits]);
  const kpiValue = (id) => operationsKpis.find((item) => item.id === id)?.value || '0';
  const pendingApprovalTotal = pipeline.approvalBottlenecks.reduce((sum, item) => sum + item.Pending + item.Rework + item.Delayed, 0);
  const sla = averageOperationRows(operationsRows, 'sla');
  const attendance = averageOperationRows(operationsRows, 'attendance');
  const approvalRing = pipeline.approvalBottlenecks.map((item) => ({
    name: item.stage,
    value: item.Pending + item.Rework + item.Delayed,
  }));
  const activity = [
    ...pipeline.activity,
    ...fieldOfficerActivity.slice(0, 3).map((officer) => ({
      event: officer.lastActivity,
      client: officer.assignedSite,
      time: officer.checkIn,
      status: officer.status,
    })),
  ].slice(0, 7);
  const approvalRows = pipeline.approvalBottlenecks.map((item) => ({
    ...item,
    owner: `${item.stage} Team`,
    total: item.Pending + item.Rework + item.Delayed,
    status: item.Delayed ? 'Critical' : item.Pending ? 'Pending' : 'Healthy',
  }));
  const managementKpis = [
    { title: 'Total Pipeline Value', value: formatInr(pipeline.proposalValue), change: 'Current workflow value', icon: TrendingUp, tone: 'blue' },
    { title: 'Conversion %', value: `${pipeline.flow.at(-1)?.conversion || 0}%`, change: 'Lead to converted', icon: CheckCircle2, tone: 'violet' },
    { title: 'Open Proposals', value: pipeline.flow.find((item) => item.stage === 'Proposal')?.count || 0, change: 'Ready or sent', icon: FileText, tone: 'violet' },
    { title: 'Pending Approvals', value: pendingApprovalTotal, change: 'Across departments', icon: Clock3, tone: 'amber' },
    { title: 'Sites Operational', value: kpiValue('activeSites'), change: `${operationsRows.length} regions monitored`, icon: BriefcaseBusiness, tone: 'green' },
    { title: 'Active FO Today', value: kpiValue('fieldOfficersActive'), change: `${attendance}% present`, icon: UserCheck, tone: 'green' },
    { title: 'SLA Compliance', value: `${sla}%`, change: 'Operations health', icon: CheckCircle2, tone: sla >= 92 ? 'green' : 'amber' },
  ];
  const mapCoordinates = {
    'Tamil Nadu': [13.0827, 80.2707],
    Kerala: [9.9312, 76.2673],
    Karnataka: [12.9716, 77.5946],
    Telangana: [17.385, 78.4867],
    'Andhra Pradesh - 1': [17.6868, 83.2185],
    'Andhra Pradesh - 2': [16.5062, 80.648],
  };

  return (
    <div className="space-y-3">
      <section className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <label className="command-pill min-w-44">
          <CalendarCheck2 className="h-3.5 w-3.5" />
          13 May - 19 May 2026
        </label>
        <label className="command-pill min-w-44">
          <MapPin className="h-3.5 w-3.5" />
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className="min-w-32 bg-transparent text-[11px] font-semibold outline-none dark:text-slate-200"
          >
            {stateFilterOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
        {managementKpis.map((kpi) => (
          <article key={kpi.title} className="command-kpi">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="command-label">{kpi.title}</p>
                <p className="mt-1.5 text-[22px] font-bold leading-none text-slate-950 dark:text-white">{kpi.value}</p>
              </div>
              <span className={`rounded-lg p-2 ${
                kpi.tone === 'green' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : kpi.tone === 'amber' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
                    : kpi.tone === 'violet' ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'
                      : 'bg-qpms-50 text-qpms-600 dark:bg-qpms-500/15 dark:text-qpms-300'
              }`}><kpi.icon className="h-4 w-4" /></span>
            </div>
            <p className="mt-2 text-[10px] font-semibold text-emerald-600">{kpi.change}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.82fr_0.86fr_0.94fr_1.08fr]">
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Pipeline Conversion Funnel</h2></div>
          <div className="space-y-1.5 p-3.5">
            {pipeline.flow.map((step, index) => (
              <div key={step.stage} className="grid grid-cols-[64px_1fr_30px] items-center gap-2 text-[10px]">
                <span className="font-semibold text-slate-600 dark:text-slate-300">{step.stage}</span>
                <div
                  className="mx-auto flex h-6 items-center justify-center rounded-sm text-white"
                  style={{
                    width: `${Math.max(22, 100 - index * 9)}%`,
                    background: ['#315efb', '#3686f4', '#16b3ca', '#12a968', '#f5be2e', '#f59e0b', '#fb7230', '#ef3b58'][index % 8],
                  }}
                >
                  {step.conversion}%
                </div>
                <span className="text-right font-bold">{step.count}</span>
              </div>
            ))}
            <p className="pt-2 text-[11px] font-bold text-emerald-600">Conversion rate {pipeline.flow.at(-1)?.conversion || 0}%</p>
          </div>
        </section>

        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Pipeline Value Breakup</h2></div>
          <div className="h-[248px] p-2">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 260, height: 220 }}>
              <PieChart>
                <Pie data={pipeline.flow.slice(0, 6).map((item) => ({ name: item.stage, value: Math.max(item.count, 1) }))} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={1}>
                  {pipeline.flow.slice(0, 6).map((item, index) => <Cell key={item.stage} fill={['#315efb', '#8055ff', '#14b8a6', '#f97316', '#13a863', '#0ea5e9'][index]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Proposal Value Trend</h2></div>
          <div className="h-[218px] p-3">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 290, height: 194 }}>
              <AreaChart data={pipeline.proposalTrend}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: chartText }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="pipelineValue" stroke="#315efb" fill="#dce8ff" strokeWidth={2.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="px-4 pb-3 text-[11px] font-semibold text-emerald-600">{formatInr(pipeline.proposalValue)} current pipeline</p>
        </section>

        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Live FO Tracking Map</h2><Link className="text-[11px] font-bold text-qpms-600" to="/fo-activities">View</Link></div>
          <div className="h-[208px] isolate overflow-hidden">
            <MapContainer center={[13.1, 78.2]} zoom={5.2} scrollWheelZoom={false} className="h-full w-full">
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {operationsRows.map((row) => (
                <CircleMarker key={row.state} center={mapCoordinates[row.state]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillOpacity: 0.95, fillColor: row.status === 'Critical' ? '#ef4444' : row.status === 'Warning' ? '#f59e0b' : '#13a863' }}>
                  <Popup>{row.state}: {row.officers} field officers</Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 p-3 text-center">
            {[['Active FO', kpiValue('fieldOfficersActive')], ['Visits', kpiValue('siteVisitsCompleted')], ['Tickets', kpiValue('openTickets')]].map(([title, value]) => <div key={title}><p className="command-label">{title}</p><p className="mt-1 text-sm font-bold">{value}</p></div>)}
          </div>
        </section>
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.78fr_0.86fr_0.86fr_1fr]">
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Approval Bottleneck</h2></div>
          {pendingApprovalTotal ? (
            <div className="h-[190px] p-2">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 250, height: 174 }}>
                <PieChart>
                  <Pie data={approvalRing} dataKey="value" nameKey="name" innerRadius={45} outerRadius={67} paddingAngle={3}>
                    {approvalRing.map((item, index) => (
                      <Cell key={item.name} fill={['#f97316', '#2e5fe7', '#06b6d4'][index]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid h-52 place-items-center rounded-xl bg-slate-50 text-center dark:bg-slate-950/55">
              <div>
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">No active bottlenecks</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">No pending approval records in the current workflow.</p>
              </div>
            </div>
          )}
        </section>
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Ticket Overview</h2></div>
          <div className="p-4">
            <p className="text-3xl font-bold">{kpiValue('openTickets')}</p>
            <p className="command-label">Total Tickets</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[['Open', kpiValue('openTickets'), 'text-qpms-600'], ['In Progress', kpiValue('pendingTasks'), 'text-amber-600'], ['Resolved', kpiValue('siteVisitsCompleted'), 'text-emerald-600']].map(([label, value, tone]) => (
                <div className="command-muted-surface p-2" key={label}><p className={`text-[10px] font-bold ${tone}`}>{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>
              ))}
            </div>
          </div>
        </section>
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">FO Attendance Overview</h2></div>
          <div className="flex items-center justify-around gap-3 p-5">
            <div className="relative grid h-24 w-24 place-items-center rounded-full" style={{ background: `conic-gradient(#13a863 ${attendance}%, #e2e8f0 ${attendance}% 100%)` }}>
              <div className="grid h-[72%] w-[72%] place-items-center rounded-full bg-white dark:bg-[#081522]"><p className="text-lg font-bold">{attendance}%</p></div>
            </div>
            <div className="space-y-3 text-xs font-semibold">
              <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />Present</p>
              <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-rose-500" />Absent</p>
              <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500" />On Leave</p>
            </div>
          </div>
        </section>
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Today's FO Activity</h2><Link className="text-[11px] font-bold text-qpms-600" to="/fo-activities">View All</Link></div>
          <div className="space-y-3 p-3">
            {fieldOfficerActivity.slice(0, 5).map((officer) => (
              <div key={officer.id} className="grid grid-cols-[12px_1fr_auto] items-center gap-2 text-[11px] font-semibold">
                <span className={`h-2 w-2 rounded-full ${officer.status === 'Offline' ? 'bg-rose-500' : officer.status === 'Active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="truncate"><strong>{officer.name}</strong> <span className="text-slate-500">{officer.assignedSite}</span></span>
                <span className="text-slate-400">{officer.checkIn}</span>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.05fr_0.72fr_0.9fr_0.9fr]">
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Visits By Region (This Week)</h2></div>
          <div className="h-[200px] p-3">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 400, height: 174 }}>
              <BarChart data={operationsRows}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 10 }} interval={0} height={42} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="visits" fill="#2e5fe7" radius={[6, 6, 0, 0]} name="Visits" />
                <Bar dataKey="tickets" fill="#f59e0b" radius={[6, 6, 0, 0]} name="Tickets" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Business Health Score</h2></div>
          <div className="grid place-items-center p-5">
            <div className="relative grid h-28 w-28 place-items-center rounded-full" style={{ background: 'conic-gradient(#13a863 72%, #f59e0b 72% 89%, #ef4444 89% 100%)' }}>
              <div className="grid h-[72%] w-[72%] place-items-center rounded-full bg-white dark:bg-[#081522]"><div className="text-center"><p className="text-2xl font-bold">{sla}%</p><p className="text-[10px]">Healthy</p></div></div>
            </div>
          </div>
        </section>
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Top Pending Approvals</h2></div>
          <div className="space-y-2">
            {approvalRows.map((row) => (
              <div key={row.stage} className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5 last:border-0 dark:border-slate-800">
                <div>
                  <p className="text-xs font-bold text-slate-950 dark:text-white">{row.owner}</p>
                  <p className="text-[10px] font-semibold text-slate-500">{row.Pending} pending / {row.Delayed} delayed</p>
                </div>
                <StatusBadge status={row.status} />
              </div>
            ))}
          </div>
        </section>
        <section className="command-panel">
          <div className="command-panel-head"><h2 className="command-title">Recent Activity</h2></div>
          <div className="max-h-52 space-y-3 overflow-y-auto p-3">
            {activity.length ? activity.map((item, index) => (
              <div key={`${item.client}-${item.event}-${index}`} className="flex gap-3 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-qpms-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-950 dark:text-white">{item.event}</p>
                  <p className="truncate text-xs font-semibold text-slate-500">{item.client}</p>
                </div>
                <p className="whitespace-nowrap text-[10px] font-bold uppercase text-slate-400">{item.time}</p>
              </div>
            )) : <p className="text-sm font-semibold text-slate-500">No workflow activity recorded.</p>}
          </div>
        </section>
      </section>
    </div>
  );
}

export function ExistingBusinessOperations({ activeOperationsSection, onSectionChange }) {
  const [businessFilter, setBusinessFilter] = useState('All Businesses');
  const [stateFilter, setStateFilter] = useState('All States');
  const filteredSummary = useMemo(() => filterOperationSummary(businessFilter, stateFilter), [businessFilter, stateFilter]);
  const operationKpis = useMemo(() => buildOperationsKpis(filteredSummary), [filteredSummary]);
  const operationSections = useMemo(
    () => buildFilteredOperationsDetailSections(filteredSummary, businessFilter, stateFilter),
    [filteredSummary, businessFilter, stateFilter],
  );
  const snapshotRows = useMemo(() => buildBusinessSnapshot(businessFilter, stateFilter), [businessFilter, stateFilter]);
  const status = operationsStatus(filteredSummary);
  const filteredOfficers = useMemo(
    () => filterRowsByState(fieldOfficerActivity, filteredSummary),
    [filteredSummary],
  );
  const filteredTaskDistribution = useMemo(() => buildTaskDistribution(filteredSummary), [filteredSummary]);

  return (
    <div className="space-y-6">
      <section className="enterprise-card p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-950 dark:text-white">Existing Business Operations</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(180px,220px)_minmax(180px,220px)_auto] sm:items-end">
            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Business Filter</span>
              <select
                value={businessFilter}
                onChange={(event) => {
                  setBusinessFilter(event.target.value);
                  onSectionChange(null);
                }}
                className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              >
                {businessFilterOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">State Filter</span>
              <select
                value={stateFilter}
                onChange={(event) => {
                  setStateFilter(event.target.value);
                  onSectionChange(null);
                }}
                className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              >
                {stateFilterOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <span className={`inline-flex h-10 items-center justify-center rounded-xl px-3 text-xs font-bold ring-1 ${healthTone[status.tone]}`}>
              {status.label}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {operationKpis.map((kpi) => (
          <KpiCard
            key={kpi.title}
            {...kpi}
            isActive={activeOperationsSection === kpi.id}
            onClick={() => onSectionChange(activeOperationsSection === kpi.id ? null : kpi.id)}
          />
        ))}
      </section>

      {activeOperationsSection ? (
        <DashboardDetailPanel
          sectionId={activeOperationsSection}
          sections={operationSections}
          renderChart={(sectionId) => <OperationsDrilldownChart sectionId={sectionId} summaryRows={filteredSummary} />}
        />
      ) : (
        <div className="space-y-6 animate-[login-fade-up_220ms_ease-out]">
          <FoGpsTestDashboard />

          <ChartCard title="Business Performance Snapshot">
            <DataTable columns={businessSnapshotColumns} rows={snapshotRows} embedded />
          </ChartCard>

          <section className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="State-wise Site Performance">
              <ChartFrame>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredSummary}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="activeSites" fill="#2444a4" radius={[10, 10, 0, 0]} name="Active Sites" />
                    <Bar dataKey="officers" fill="#85adff" radius={[10, 10, 0, 0]} name="Field Officers" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>

            <ChartCard title="Attendance by State">
              <ChartFrame>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={filteredSummary}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="attendance" fill="#10b981" radius={[10, 10, 0, 0]} name="Attendance %" />
                    <Line type="monotone" dataKey="visits" stroke="#2444a4" strokeWidth={3} name="Site Visits" />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <ChartCard title="Ticket Volume by State">
              <ChartFrame>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredSummary}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="state" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} interval={0} height={62} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="tickets" fill="#f59e0b" radius={[10, 10, 0, 0]} name="Open Tickets" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>

            <ChartCard title="Task Completion Distribution">
              <ChartFrame>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={filteredTaskDistribution} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
                      {filteredTaskDistribution.map((entry, index) => (
                        <Cell key={entry.name} fill={taskColors[index]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Site Visit Trend">
              <ChartFrame>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={siteVisitTrend}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="visits" stroke="#2444a4" strokeWidth={3} name="Planned Visits" />
                    <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={3} name="Completed Visits" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>

            <ChartCard title="SLA Performance by State">
              <ChartFrame>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={filteredSummary}>
                    <PolarGrid stroke={chartGrid} />
                    <PolarAngleAxis dataKey="state" tick={{ fill: chartText, fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[70, 100]} tick={{ fill: chartText, fontSize: 11 }} />
                    <Radar name="SLA %" dataKey="sla" stroke="#2444a4" fill="#4f82fb" fillOpacity={0.35} />
                    <Tooltip contentStyle={tooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>
          </section>

          <ChartCard title="State-wise Operations Summary">
            <DataTable columns={operationsColumns} rows={filteredSummary} embedded />
          </ChartCard>

          <ChartCard title="Field Officer Activity">
            <DataTable columns={officerColumns} rows={filteredOfficers} embedded />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function ApprovalDashboard({ title, description, stage, siteVisits, leads, user }) {
  const queue = siteVisits.filter((visit) => (visit.reviewStatus?.[stage] || ((visit.currentStage || visit.status) === stage ? 'Pending' : '')) === 'Pending');
  const pending = queue.filter((visit) => !['Approved', 'Rejected', 'Rework Requested'].includes(visit.approvalStatus)).length;
  const scope = reviewerScopeMatrix[stage] || reviewerScopeMatrix['Commercial Review'];
  const stageMatrix = Object.keys(workflowStageOwners).map((name) => {
    const visitsForStage = siteVisits.filter((visit) => visit.reviewStatus?.[name] || visit.currentStage === name);
    return {
      stage: name.replace(' Costing', '').replace(' Review', '').replace(' Validation', ''),
      Pending: visitsForStage.filter((visit) => (visit.reviewStatus?.[name] || (visit.currentStage === name ? 'Pending' : '')) === 'Pending').length,
      Approved: visitsForStage.filter((visit) => visit.reviewStatus?.[name] === 'Approved').length,
      Rework: visitsForStage.filter((visit) => visit.reviewStatus?.[name] === 'Rework Requested').length,
    };
  });
  const agingData = [
    { bucket: '0-2 days', records: Math.max(1, queue.length - 2) },
    { bucket: '3-5 days', records: queue.length ? 1 : 0 },
    { bucket: '6+ days', records: queue.length > 2 ? 1 : 0 },
  ];
  const scopeData = [
    { type: 'Editable', value: scope.editable },
    { type: 'View Only', value: scope.viewOnly },
    { type: 'Hidden', value: scope.hidden },
  ];
  const kpis = [
    { title: 'Pending Queue', value: pending, change: `Pending with ${workflowStageOwners[stage] || stage}`, icon: Clock3, tone: 'amber' },
    { title: 'Submitted Records', value: queue.length, change: 'Records in your review scope', icon: Layers3, tone: 'blue' },
    { title: 'Approved Stages', value: siteVisits.filter((visit) => visit.reviewStatus?.[stage] === 'Approved').length, change: 'Completed by this function', icon: CheckCircle2, tone: 'green' },
    { title: 'Rework / Risk', value: siteVisits.filter((visit) => ['Rework Requested', 'Rejected'].includes(visit.reviewStatus?.[stage])).length, change: 'Needs BD correction or closure', icon: AlertTriangle, tone: 'red' },
  ];

  return (
    <div className="space-y-6">
      <CommandCenterOverview user={user} leads={leads} siteVisits={siteVisits} stage={stage} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.title} {...kpi} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <ChartCard title={`${title} Scope Matrix`}>
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={scopeData} dataKey="value" nameKey="type" innerRadius={62} outerRadius={92} paddingAngle={3}>
                  {scopeData.map((entry) => (
                    <Cell key={entry.type} fill={entry.type === 'Editable' ? '#10b981' : entry.type === 'View Only' ? '#2444a4' : '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartFrame>
        </ChartCard>

        <ChartCard title="Workflow Stage Matrix">
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageMatrix} margin={{ left: 4 }}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Pending" stackId="stage" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Approved" stackId="stage" fill="#10b981" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Rework" stackId="stage" fill="#ef4444" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </ChartCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <ChartCard title="Review Aging">
          <ChartFrame height="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: chartText, fontSize: 12 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="records" fill="#4f82fb" radius={[10, 10, 0, 0]} name="Records" />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </ChartCard>

        <ChartCard title="Role Access Coverage">
          <div className="space-y-3">
            {scope.rows.map((row) => (
              <div key={row.area} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/55">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{row.area}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{row.count} mapped fields / checkpoints</p>
                </div>
                <span className={[
                  'rounded-full px-3 py-1 text-xs font-bold',
                  row.access === 'Editable'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : row.access === 'Hidden'
                      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      : 'bg-qpms-50 text-qpms-700 dark:bg-qpms-500/15 dark:text-qpms-300',
                ].join(' ')}
                >
                  {row.access}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      </section>

      <section className="enterprise-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h2>
          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Client', 'Submitted date', 'Stage', 'Pending with', 'Status', 'Remarks'].map((heading) => (
                  <th key={heading} className="px-3 py-3 font-bold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {queue.length ? queue.map((visit) => (
                <tr key={visit.id}>
                  <td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">{visit.company}</td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{visit.lastApprovalAt ? new Date(visit.lastApprovalAt).toLocaleDateString() : 'Pending'}</td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{visit.currentStage}</td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{visit.pendingWith || stage}</td>
                  <td className="px-3 py-3"><StatusBadge status={visit.approvalStatus || 'Pending'} /></td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{visit.approvalRemarks || 'No shared remarks'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="6" className="px-3 py-8 text-center text-sm font-semibold text-slate-500">No records are pending.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { leads, siteVisits } = useWorkflow();
  const location = useLocation();
  const [activeOperationsSection, setActiveOperationsSection] = useState(null);
  usePageTitle('Dashboard');
  const restrictedToPipeline = ['BD Head', 'BD Executive'].includes(user?.role);
  const reviewerDashboard = isOperationsTeam(user)
    ? {
        title: 'Operations Review',
            description: '',
        queueTitle: 'Operations Review Queue',
        queueDescription: 'Review queue.',
        stage: 'Operations Review',
      }
    : isCoordinator(user)
      ? {
          title: 'Coordinator Review',
          description: '',
          queueTitle: 'Coordinator Costing Queue',
          queueDescription: 'Review queue.',
          stage: 'Coordinator Costing Review',
        }
      : isHrReviewer(user)
        ? {
            title: 'HR Review',
            description: '',
            queueTitle: 'HR Review Queue',
            queueDescription: 'Review queue.',
            stage: 'HR Validation',
          }
        : isCommercialTeam(user)
          ? {
              title: 'Commercial Review',
              description: '',
              queueTitle: 'Commercial Review Queue',
              queueDescription: 'Review queue.',
              stage: 'Commercial Review',
            }
          : isFinanceTeam(user)
            ? {
                title: 'Finance Review',
                description: '',
                queueTitle: 'Finance Review Queue',
                queueDescription: 'Review queue.',
                stage: 'Finance Review',
              }
            : null;
  const requestedWorkspace = new URLSearchParams(location.search).get('workspace');
  const executiveViewer = isManagement(user) || isFinanceLeadership(user);
  const canSeeOperations = isExistingBusinessOperations(user) || executiveViewer;
  const effectiveTab = canSeeOperations && (isExistingBusinessOperations(user) || requestedWorkspace === 'operations')
    ? 'operations'
    : 'new-business';

  const visibleLeads = useMemo(() => {
    if (canViewBdTeam(user) || user?.role === 'COO') return leads;
    return leads.filter((lead) => lead.assigned_bd_email === user?.email || lead.created_by_user_id === user?.id);
  }, [leads, user]);

  const visibleSiteVisits = useMemo(() => {
    if (canViewBdTeam(user) || user?.role === 'COO') return siteVisits;
    return siteVisits.filter((visit) => visit.assigned_bd_email === user?.email || visit.created_by_user_id === user?.id);
  }, [siteVisits, user]);

  return (
    <div className="space-y-7">
      <PageHeader
        title={reviewerDashboard?.title || (executiveViewer ? `Welcome back, ${user?.name || 'Admin'}` : 'Dashboard')}
        description={reviewerDashboard?.description}
        actions={null}
      />

      {reviewerDashboard && effectiveTab === 'new-business' ? (
        <ApprovalDashboard
          title={reviewerDashboard.queueTitle}
          description={reviewerDashboard.queueDescription}
          stage={reviewerDashboard.stage}
          siteVisits={siteVisits}
          leads={leads}
          user={user}
        />
      ) : executiveViewer && effectiveTab === 'new-business' ? (
        <ExecutiveOperationsCommandCenter leads={leads} siteVisits={siteVisits} />
      ) : effectiveTab === 'new-business' || restrictedToPipeline ? (
        <NewBusinessPipeline
          visibleLeads={visibleLeads}
          visibleSiteVisits={visibleSiteVisits}
          user={user}
        />
      ) : (
        <ExistingBusinessOperations
          activeOperationsSection={activeOperationsSection}
          onSectionChange={setActiveOperationsSection}
        />
      )}
    </div>
  );
}
