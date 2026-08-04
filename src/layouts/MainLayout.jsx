import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Sidebar from '../components/Sidebar.jsx';
import { useAuth } from '../context/auth-context.js';
import { canAccessRoute } from '../utils/authRoles.js';
import { isDemoUser } from '../utils/demoAccess.js';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState('light');
  const { user, session, authStatus, authError } = useAuth();
  const location = useLocation();

  if (authStatus === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm font-semibold text-slate-500">
        Verifying secure access...
      </div>
    );
  }

  if (!user || (!session && !user.isDemoReadOnly)) {
    return <Navigate to="/login" state={{ from: location, sessionMessage: authError || '' }} replace />;
  }

  if (user.requiresPasswordChange) {
    return <Navigate to="/set-password" replace />;
  }

  if (!canAccessRoute(user, location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  const usesWideWorkspace = ['/fo-activities', '/dashboard', '/existing-business', '/tickets', '/store-master', '/operations/hospital-feedback'].some((path) => location.pathname.startsWith(path));

  return (
    <div className={`min-h-screen bg-slate-50 transition-colors dark:bg-slate-950 ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="flex min-h-screen">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="min-w-0 flex-1">
          <Navbar onMenuClick={() => setSidebarOpen(true)} theme={theme} onThemeToggle={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))} />
          <main className={usesWideWorkspace ? 'w-full px-3 py-4 sm:px-4 lg:px-5 xl:px-6' : 'mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8'}>
            {isDemoUser(user) ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 shadow-sm">
                <span className="mr-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-800">
                  Tender Demo
                </span>
                Read-Only Access
              </div>
            ) : null}
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
