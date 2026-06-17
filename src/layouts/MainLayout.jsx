import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Sidebar from '../components/Sidebar.jsx';
import { useAuth } from '../context/auth-context.js';
import { canAccessRoute } from '../utils/authRoles.js';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState('light');
  const { user, authStatus } = useAuth();
  const location = useLocation();

  if (authStatus === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm font-semibold text-slate-500">
        Verifying secure access...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessRoute(user, location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  const usesWideWorkspace = ['/fo-activities', '/dashboard', '/existing-business'].some((path) => location.pathname.startsWith(path));

  return (
    <div className={`min-h-screen bg-slate-50 transition-colors dark:bg-slate-950 ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="flex min-h-screen">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="min-w-0 flex-1">
          <Navbar onMenuClick={() => setSidebarOpen(true)} theme={theme} onThemeToggle={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))} />
          <main className={usesWideWorkspace ? 'w-full px-3 py-4 sm:px-4 lg:px-5 xl:px-6' : 'mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8'}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
