import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Home,
  ListChecks,
  LogOut,
  MapPinned,
  Menu,
  ShieldCheck,
  Sparkles,
  Wrench,
  Workflow,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { endTenderDemoSession, hasTenderDemoSession, isTenderDemoModeEnabled } from '../config/tenderDemo.js';

const demoNavItems = [
  { label: 'Dashboard', to: '/demo/dashboard', icon: Home },
  { label: 'Lead Management', to: '/demo/leads', icon: Workflow },
  { label: 'Site Visit + Estimation', to: '/demo/site-visits', icon: ClipboardCheck },
  { label: 'HR Review', to: '/demo/hr-review', icon: ShieldCheck },
  { label: 'Commercial Review', to: '/demo/commercial-review', icon: ShieldCheck },
  { label: 'Finance Review', to: '/demo/finance-review', icon: ShieldCheck },
  { label: 'Proposals', to: '/demo/proposals', icon: FileText },
  { label: 'Approvals', to: '/demo/approvals', icon: ShieldCheck },
  { label: 'Existing Business', to: '/demo/existing-business', icon: ListChecks },
  { label: 'Operations', to: '/demo/operations', icon: MapPinned },
  { label: 'Tickets', to: '/demo/tickets', icon: FileText },
  { label: 'Soft Services Feedback', to: '/demo/soft-services-feedback', icon: BarChart3 },
  { label: 'Fault Tracker', to: '/demo/fault-tracker', icon: ClipboardList },
  { label: 'Deep Cleaning', to: '/demo/deep-cleaning', icon: Sparkles },
  { label: 'Asset Management', to: '/demo/asset-management', icon: Wrench },
  { label: 'Reports', to: '/demo/reports', icon: BarChart3 },
];

export default function TenderDemoLayout() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  if (!isTenderDemoModeEnabled() || !hasTenderDemoSession()) {
    return <Navigate to="/demo-login" replace />;
  }

  function handleLogout() {
    endTenderDemoSession();
    navigate('/demo-login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        <div
          className={`fixed inset-0 z-30 bg-slate-950/30 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <Logo className="h-10 w-10" />
            <button type="button" className="focus-ring rounded-xl p-2 text-slate-500 lg:hidden" onClick={() => setIsOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-amber-800">
            Demonstration Environment
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-5">
            {demoNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) => [
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  isActive ? 'bg-gradient-to-r from-qpms-700 to-qpms-500 text-white shadow-lg shadow-qpms-600/20' : 'text-slate-600 hover:bg-qpms-50 hover:text-qpms-700',
                ].join(' ')}
              >
                <item.icon className="h-5 w-5 shrink-0" strokeWidth={2.2} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/94 backdrop-blur-xl">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <button type="button" onClick={() => setIsOpen(true)} className="focus-ring rounded-xl border border-slate-200 p-2 text-slate-600 lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-950">myQPMS Tender Demo</p>
                <p className="truncate text-xs font-semibold text-slate-500">Fictional sample data only</p>
              </div>
              <button type="button" onClick={handleLogout} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50">
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </header>

          <main className="w-full px-4 py-5 sm:px-6 lg:px-8">
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 shadow-sm">
              myQPMS Demonstration Environment — All information shown is fictional sample data.
            </div>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
