import { Bell, ChevronDown, ImageIcon, LogOut, Menu, Moon, Search, SlidersHorizontal, Sun, TicketCheck, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context.js';
import {
  getHospitalTicketNotifications,
  markHospitalTicketNotificationRead,
} from '../services/hospitalTicketsApi.js';

const NOTIFICATION_POLL_MS = 45000;

export default function Navbar({ onMenuClick, theme = 'light', onThemeToggle }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accountRef = useRef(null);
  const notificationsRef = useRef(null);
  const hospitalNotificationsUnavailableRef = useRef(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const displayName = user?.name || 'Admin';
  const role = user?.role || 'Admin';
  const profileImageUrl = user?.profileImageUrl || user?.metadata?.profile_image_url || '';
  const showProfileImage = Boolean(profileImageUrl) && failedAvatarUrl !== profileImageUrl;
  const userKey = String(user?.id || user?.email || user?.name || '');
  const visibleNotifications = notifications.filter((item) => item.userKey === userKey);
  const filteredNotifications = notificationFilter === 'unread'
    ? visibleNotifications.filter((item) => !item.readAt)
    : visibleNotifications;
  const notificationGroups = groupNotifications(filteredNotifications.slice(0, 30));
  const unreadCount = visibleNotifications.filter((item) => !item.readAt).length;
  const unreadBadge = unreadCount > 99 ? '99+' : String(unreadCount);
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
      if (!notificationsRef.current?.contains(event.target)) {
        setIsNotificationsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const loadNotifications = useCallback(async ({ quiet = false } = {}) => {
    if (!userKey || hospitalNotificationsUnavailableRef.current) {
      return;
    }
    if (!quiet) setNotificationsLoading(true);
    try {
      const response = await getHospitalTicketNotifications();
      setNotifications(normalizeNotifications(response.notifications, userKey));
      setNotificationsError('');
      hospitalNotificationsUnavailableRef.current = false;
    } catch (error) {
      setNotifications((items) => items.filter((item) => item.userKey !== userKey));
      const status = error?.response?.status;
      const code = error?.response?.data?.code;
      if (status === 403 && code === 'inactive_hospital_profile') {
        hospitalNotificationsUnavailableRef.current = true;
        setNotificationsError('');
      } else {
        setNotificationsError('Unable to load notifications.');
      }
    } finally {
      if (!quiet) setNotificationsLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    hospitalNotificationsUnavailableRef.current = false;
    setNotifications((items) => items.filter((item) => item.userKey !== userKey));
    setNotificationsError('');
    if (!userKey) {
      return undefined;
    }
    const initialLoadId = window.setTimeout(() => {
      loadNotifications({ quiet: true });
    }, 0);
    const intervalId = window.setInterval(() => {
      loadNotifications({ quiet: true });
    }, NOTIFICATION_POLL_MS);
    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadNotifications, userKey]);

  function handleLogout() {
    logout();
    setIsAccountOpen(false);
    setIsNotificationsOpen(false);
    setNotificationFilter('all');
    setNotifications([]);
    navigate('/login', { replace: true });
  }

  function handleProfileOpen() {
    setIsAccountOpen(false);
    navigate('/profile');
  }

  function handleNotificationsToggle() {
    setIsNotificationsOpen((value) => {
      const next = !value;
      if (next) {
        setIsAccountOpen(false);
        loadNotifications();
      }
      return next;
    });
  }

  async function handleNotificationOpen(notification) {
    try {
      if (!notification.readAt) {
        await markHospitalTicketNotificationRead(notification.id);
        setNotifications((items) =>
          items.map((item) =>
            item.id === notification.id
              ? { ...item, readAt: new Date().toISOString() }
              : item,
          ),
        );
      }
    } catch {
      setNotificationsError('Unable to update notification.');
    }
    setIsNotificationsOpen(false);
    if (notification.ticketId) {
      navigate(`/tickets/${encodeURIComponent(notification.ticketId)}`);
    } else {
      navigate('/tickets');
    }
  }

  async function handleMarkAllRead() {
    const unread = visibleNotifications.filter((item) => !item.readAt);
    if (!unread.length) return;
    try {
      await Promise.all(unread.map((item) => markHospitalTicketNotificationRead(item.id)));
      const now = new Date().toISOString();
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || now })));
      setNotificationsError('');
    } catch {
      setNotificationsError('Some notifications could not be marked read.');
      loadNotifications({ quiet: true });
    }
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

        <div ref={notificationsRef} className="relative">
          <button
            type="button"
            onClick={handleNotificationsToggle}
            className="focus-ring relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
            aria-label="Notifications"
            aria-haspopup="menu"
            aria-expanded={isNotificationsOpen}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[10px] font-black leading-4 text-white ring-2 ring-white dark:ring-slate-900">
                {unreadBadge}
              </span>
            ) : null}
          </button>

          {isNotificationsOpen ? (
            <div className="absolute right-0 top-14 z-30 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <p className="text-sm font-black text-slate-950 dark:text-white">Notifications</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {unreadCount ? `${unreadCount} unread` : 'You are all caught up'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={!unreadCount}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-qpms-700 transition hover:bg-qpms-50 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-qpms-200 dark:hover:bg-slate-800"
                >
                  Mark all as read
                </button>
              </div>

              <div className="flex gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
                {['all', 'unread'].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setNotificationFilter(filter)}
                    className={`rounded-full px-3 py-1.5 text-xs font-black capitalize transition ${
                      notificationFilter === filter
                        ? 'bg-qpms-600 text-white'
                        : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="max-h-[420px] overflow-y-auto p-2">
                {notificationsLoading ? (
                  <div className="space-y-2 px-1 py-2">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="h-20 rounded-xl border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50" />
                    ))}
                  </div>
                ) : notificationsError && visibleNotifications.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm font-semibold text-slate-500">
                    {notificationsError}
                  </div>
                ) : filteredNotifications.length === 0 ? (
                  <div className="px-3 py-8 text-center">
                    <p className="text-sm font-black text-slate-900 dark:text-white">
                      {notificationFilter === 'unread' ? "You're all caught up" : 'No notifications'}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      {notificationFilter === 'unread' ? 'No unread notifications.' : "You're all caught up."}
                    </p>
                  </div>
                ) : (
                  Object.entries(notificationGroups).map(([group, groupItems]) => (
                    <div key={group} className="pb-1">
                      <p className="px-2 pb-1.5 pt-2 text-[11px] font-black uppercase tracking-normal text-slate-400">
                        {group}
                      </p>
                      {groupItems.map((notification) => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => handleNotificationOpen(notification)}
                          className={`mb-1 flex w-full gap-3 rounded-xl px-3 py-3 text-left transition last:mb-0 ${
                            notification.readAt
                              ? 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                              : 'bg-qpms-50/70 hover:bg-qpms-50 dark:bg-qpms-500/10 dark:hover:bg-qpms-500/15'
                          }`}
                        >
                          <NotificationThumb notification={notification} />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-start gap-2">
                              <span className={`block min-w-0 flex-1 truncate text-sm ${notification.readAt ? 'font-bold' : 'font-black'} text-slate-950 dark:text-white`}>
                                {notification.title}
                              </span>
                              {!notification.readAt ? (
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-qpms-600" aria-label="Unread notification" />
                              ) : null}
                            </span>
                            {notification.ticketNumber ? (
                              <span className="mt-0.5 block truncate text-xs font-black text-qpms-700 dark:text-qpms-200">
                                {notification.ticketNumber}
                              </span>
                            ) : null}
                            {notification.location ? (
                              <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">
                                {notification.location}
                              </span>
                            ) : null}
                            <span className="mt-1 block line-clamp-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
                              {notification.body}
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-400">
                              <span>{relativeNotificationTime(notification.createdAt)}</span>
                              {notification.type === 'awaiting_confirmation' ? (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-black text-emerald-700 ring-1 ring-emerald-100">
                                  Action Required
                                </span>
                              ) : null}
                              {notification.priority ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {formatPriority(notification.priority)}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
                {notificationsError && visibleNotifications.length > 0 ? (
                  <p className="px-3 pb-2 pt-1 text-xs font-semibold text-amber-600">
                    {notificationsError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div ref={accountRef} className="relative">
          <button
            type="button"
            onClick={() => setIsAccountOpen((value) => !value)}
            className="focus-ring flex items-center gap-3 rounded-2xl border border-slate-200 bg-white py-1.5 pl-2 pr-2.5 shadow-sm ring-1 ring-white/70 transition hover:border-qpms-200 dark:border-slate-800 dark:bg-slate-900 dark:ring-white/5 dark:hover:border-slate-700"
            aria-haspopup="menu"
            aria-expanded={isAccountOpen}
          >
            <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-qpms-600 text-sm font-bold text-white">
              {showProfileImage ? (
                <img
                  src={profileImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setFailedAvatarUrl(profileImageUrl)}
                />
              ) : (
                initials
              )}
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

function normalizeNotifications(rows, userKey) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const ticket = row?.ticket && typeof row.ticket === 'object' ? row.ticket : {};
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return {
      id: String(row?.id || ''),
      title: String(row?.title || 'Ticket update'),
      body: String(row?.body || ''),
      ticketId: String(row?.ticket_id || metadata.ticket_id || ''),
      ticketNumber: String(ticket.ticket_no || metadata.ticket_no || ''),
      createdAt: String(row?.created_at || ''),
      readAt: row?.read_at ? String(row.read_at) : '',
      priority: String(row?.priority || metadata.priority || ''),
      type: String(row?.notification_type || 'hospital_ticket_update'),
      beforeImageUrl: String(row?.before_image_url || row?.before_image?.signed_url || ''),
      location: compactLocation(ticket),
      userKey,
    };
  }).filter((row) => row.id);
}

function NotificationThumb({ notification }) {
  const [failed, setFailed] = useState(false);
  if (notification.beforeImageUrl && !failed) {
    return (
      <img
        src={notification.beforeImageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
      />
    );
  }
  const highAttention = ['incoming_supervisor_ticket', 'supervisor_acceptance_timeout', 'sla_escalation', 'ticket_reopened'].includes(notification.type);
  return (
    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border ${
      highAttention
        ? 'border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
    }`}>
      {notification.type === 'awaiting_confirmation'
        ? <TicketCheck className="h-5 w-5" />
        : <ImageIcon className="h-5 w-5" />}
    </span>
  );
}

function groupNotifications(rows) {
  return rows.reduce((groups, row) => {
    const label = notificationGroupLabel(row.createdAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(row);
    return groups;
  }, {});
}

function notificationGroupLabel(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'Earlier';
  const date = new Date(timestamp);
  const now = new Date();
  if (sameDate(date, now)) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDate(date, yesterday)) return 'Yesterday';
  return 'Earlier';
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function compactLocation(ticket) {
  const parts = [
    ticket.block_name,
    ticket.floor_name,
    ticket.department_name || ticket.location_text,
  ].filter(Boolean);
  return parts.join(' • ');
}

function formatPriority(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high' || normalized === 'critical') return 'Critical';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'low') return 'Low';
  return value;
}

function relativeNotificationTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60 * 1000) return 'Just now';
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const date = new Date(timestamp);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear()
    && date.getMonth() === yesterday.getMonth()
    && date.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
