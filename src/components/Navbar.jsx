import { Bell, ChevronDown, LogOut, Menu, Moon, Search, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context.js';

export default function Navbar({ onMenuClick, theme = 'light', onThemeToggle }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accountRef = useRef(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const displayName = user?.name || 'Admin';
  const role = user?.role || 'Admin';
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    function handlePointerDown(event) {
      if (!accountRef.current?.contains(event.target)) {
        setIsAccountOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  function handleLogout() {
    logout();
    setIsAccountOpen(false);
    navigate('/login', { replace: true });
  }

  function handleProfileOpen() {
    setIsAccountOpen(false);
    navigate('/profile');
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/86">
      <div className="flex h-18 items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenuClick}
          className="focus-ring rounded-xl border border-slate-200 p-2 text-slate-600 shadow-sm dark:border-slate-800 dark:text-slate-300 lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search leads, sites, approvals, employees..."
            className="focus-ring h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/80 pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-900"
          />
        </div>

        <button
          type="button"
          className="focus-ring hidden rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white sm:inline-flex"
          aria-label="Open filters"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onThemeToggle}
          className="focus-ring rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <button
          type="button"
          className="focus-ring relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
        </button>

        <div ref={accountRef} className="relative">
          <button
            type="button"
            onClick={() => setIsAccountOpen((value) => !value)}
            className="focus-ring flex items-center gap-3 rounded-2xl border border-slate-200 bg-white py-1.5 pl-2 pr-2.5 shadow-sm ring-1 ring-white/70 transition hover:border-qpms-200 dark:border-slate-800 dark:bg-slate-900 dark:ring-white/5 dark:hover:border-slate-700"
            aria-haspopup="menu"
            aria-expanded={isAccountOpen}
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-qpms-600 text-sm font-bold text-white">
              {initials}
            </span>
            <span className="hidden min-w-0 text-left md:block">
              <span className="block truncate text-sm font-bold leading-5 text-slate-950 dark:text-white">{displayName}</span>
              <span className="block truncate text-xs font-medium leading-4 text-slate-500">{role}</span>
            </span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isAccountOpen ? 'rotate-180' : ''}`} />
          </button>

          {isAccountOpen ? (
            <div
              role="menu"
            className="absolute right-0 top-14 z-30 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:border-slate-800 dark:bg-slate-900"
          >
              <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
                <p className="truncate text-sm font-bold text-slate-950 dark:text-white">{displayName}</p>
                <p className="truncate text-xs font-medium text-slate-500">{role}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={handleProfileOpen}
                className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <UserRound className="h-4 w-4" />
                My Profile
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
