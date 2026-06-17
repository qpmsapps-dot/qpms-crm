import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  FileText,
  Home,
  ListChecks,
  MapPinned,
  Settings,
  ShieldCheck,
  Wrench,
  Workflow,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth-context.js';
import {
  isApprovalReviewer,
  isAdmin,
  isCoordinator,
  isExistingBusinessOperations,
  isFinanceLeadership,
  isFinanceTeam,
  isHrReviewer,
  isManagement,
  isOperationsTeam,
} from '../data/mockUsers.js';
import { canAccessNavRoute } from '../utils/authRoles.js';
import Logo from './Logo.jsx';

const executiveNavGroups = [
  {
    title: 'Command Center',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: Home },
      { label: 'Lead Management', to: '/crm', icon: Workflow },
      { label: 'Site Visit + Estimation', to: '/site-monitoring', icon: ClipboardCheck },
      { label: 'Proposals', to: '/proposals', icon: FileText },
      { label: 'Approvals', to: '/approvals', icon: ShieldCheck },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Existing Business', to: '/existing-business', icon: ListChecks },
      { label: 'Operations', to: '/fo-activities', icon: MapPinned },
      { label: 'Tickets', to: '/tickets', icon: FileText },
      { label: 'Asset Management', to: '/assets', icon: Wrench },
      { label: 'Reports', to: '/reports', icon: BarChart3 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

const adminDemoNavGroups = [
  {
    title: 'Workspace',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: Home },
      { label: 'Lead Management', to: '/crm', icon: Workflow },
      { label: 'Site Visit + Estimation', to: '/sites', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Demo Reviews',
    items: [
      { label: 'HR Review', to: '/tasks?stage=HR%20Validation', icon: ShieldCheck },
      { label: 'Commercial Review', to: '/tasks?stage=Commercial%20Review', icon: ShieldCheck },
      { label: 'Finance Review', to: '/tasks?stage=Finance%20Review', icon: ShieldCheck },
      { label: 'Proposals', to: '/proposals', icon: FileText },
      { label: 'Approvals', to: '/approvals', icon: ShieldCheck },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Existing Business', to: '/existing-business', icon: ListChecks },
      { label: 'Operations', to: '/fo-activities', icon: MapPinned },
      { label: 'Tickets', to: '/tickets', icon: FileText },
      { label: 'Asset Management', to: '/assets', icon: Wrench },
      { label: 'Reports', to: '/reports', icon: BarChart3 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

const businessNavGroups = [
  {
    title: 'Workspace',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: Home },
      { label: 'Lead Management', to: '/crm', icon: Workflow },
      { label: 'Site Visit + Estimation', to: '/sites', icon: ClipboardCheck },
      { label: 'Proposals', to: '/proposals', icon: FileText },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

const reviewNavGroups = [
  {
    title: 'Review Workbench',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: Home },
      { label: 'Assigned Approvals', to: '/tasks', icon: ShieldCheck },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

const operationsNavGroups = [
  {
    title: 'Operations',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: Home },
      { label: 'Existing Business', to: '/existing-business', icon: ListChecks },
      { label: 'Operations', to: '/fo-activities', icon: MapPinned },
      { label: 'Tickets', to: '/tickets', icon: FileText },
      { label: 'Asset Management', to: '/assets', icon: Wrench },
      { label: 'Reports', to: '/reports', icon: BarChart3 },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

function navLabelForRole(item, user) {
  if (item.to !== '/tasks') return item.label;
  if (isFinanceTeam(user)) return 'Finance Review';
  if (isHrReviewer(user)) return 'HR Review';
  if (isOperationsTeam(user)) return 'Operations Review';
  if (isCoordinator(user)) return 'Coordinator Review';
  return 'Commercial Review';
}

export default function Sidebar({ isOpen, isCollapsed = false, onClose, onToggleCollapse }) {
  const { user } = useAuth();
  const location = useLocation();
  const currentTarget = `${location.pathname}${location.search}`;
  const executiveViewer = isManagement(user) || isFinanceLeadership(user);
  const navGroups = isAdmin(user)
    ? adminDemoNavGroups
    : executiveViewer
    ? executiveNavGroups
    : isApprovalReviewer(user)
      ? reviewNavGroups
      : isExistingBusinessOperations(user)
        ? operationsNavGroups
        : businessNavGroups;
  const visibleNavGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const routePath = item.to.split('?')[0];
      return canAccessNavRoute(user, routePath);
    }),
  })).filter((group) => group.items.length);

  const visibleNavItems = visibleNavGroups.flatMap((group) => group.items);
  const hasVisibleNav = visibleNavItems.length > 0;
  if (!hasVisibleNav) {
    visibleNavGroups.push({
      title: 'Admin',
      items: [{ label: 'Settings', to: '/settings', icon: Settings }],
    });
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-sm transition-opacity lg:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-[width,transform] duration-300 dark:border-slate-800 dark:bg-slate-950 lg:static lg:translate-x-0 ${isCollapsed ? 'lg:w-20' : 'lg:w-72'} ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className={`border-b border-slate-100 px-5 py-4 dark:border-slate-800 ${isCollapsed ? 'lg:px-3' : ''}`}>
          <div className={`relative flex items-center gap-2 rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-qpms-50/70 p-3 shadow-sm ring-1 ring-white/70 dark:border-slate-800 dark:from-slate-950 dark:to-qpms-900/10 dark:ring-white/5 ${isCollapsed ? 'lg:justify-center' : 'justify-between'}`}>
            <Logo className="h-10 w-10" showText={!isCollapsed} />
            <button
              type="button"
              onClick={onToggleCollapse}
              className={`focus-ring hidden h-8 w-8 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:text-qpms-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 lg:grid ${isCollapsed ? 'lg:absolute lg:left-14 lg:top-6' : ''}`}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <nav className={`flex-1 space-y-5 overflow-y-auto py-5 ${isCollapsed ? 'lg:px-3 px-4' : 'px-4'}`}>
          {visibleNavGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className={`px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 ${isCollapsed ? 'lg:sr-only' : ''}`}>{group.title}</p>
              {group.items.map((item) => {
                const active = item.to.includes('?')
                  ? currentTarget === item.to
                  : location.pathname === item.to && !currentTarget.startsWith(`${item.to}?workspace=`);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    title={navLabelForRole(item, user)}
                    className={[
                      `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isCollapsed ? 'lg:justify-center' : ''}`,
                      active
                        ? 'bg-gradient-to-r from-qpms-700 to-qpms-500 text-white shadow-lg shadow-qpms-600/20'
                        : 'text-slate-600 hover:bg-qpms-50 hover:text-qpms-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white',
                    ].join(' ')}
                  >
                    <item.icon className="h-5 w-5 shrink-0" strokeWidth={2.2} />
                    <span className={isCollapsed ? 'lg:sr-only' : ''}>{navLabelForRole(item, user)}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
