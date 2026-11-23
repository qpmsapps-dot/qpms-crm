import {
  ArrowRight,
  Eye,
  EyeOff,
  Globe2,
  Instagram,
  Linkedin,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { useAuth } from '../context/auth-context.js';
import { findMockUser } from '../data/mockUsers.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { isDemoReadOnlyUser } from '../utils/demoAccess.js';

const socialLinks = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/qpms-india/', icon: Linkedin },
  { label: 'Website', href: 'https://qpms.in/', icon: Globe2 },
  { label: 'Instagram', href: 'https://www.instagram.com/qpms.in/', icon: Instagram },
  { label: 'Email', href: 'mailto:info@qpms.in', icon: Mail },
];

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem('qpms-remembered-email') || ''; } catch { return ''; }
  });
  const [rememberEmail, setRememberEmail] = useState(Boolean(username));
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithAppPassword, loginWithPassword, isDemoAuthEnabled } = useAuth();
  usePageTitle('Sign in');

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting || resetting) return;
    setError('');
    setNotice('');
    if (!username.trim() || !password) { setError('Enter your email and password.'); return; }
    setIsSubmitting(true);

    const normalizedUsername = username.trim().toLowerCase();
    function rememberSuccessfulEmail() {
      try {
        if (rememberEmail) localStorage.setItem('qpms-remembered-email', normalizedUsername);
        else localStorage.removeItem('qpms-remembered-email');
      } catch { /* Storage may be unavailable. */ }
    }

    if (!isDemoAuthEnabled) {
      try {
        const nextUser = await loginWithPassword(normalizedUsername, password);
        rememberSuccessfulEmail();
        if (nextUser?.requiresPasswordChange) {
          navigate('/set-password', { replace: true });
          return nextUser;
        }
        const returnLocation = location.state?.from;
        const returnPath = returnLocation?.pathname
          ? `${returnLocation.pathname}${returnLocation.search || ''}${returnLocation.hash || ''}`
          : '';
        navigate(returnPath && returnPath !== '/login' ? returnPath : '/dashboard', { replace: true });
        return nextUser;
      } catch (authError) {
        setError(authError.message || 'Unable to sign in with Supabase Auth.');
        setIsSubmitting(false);
        return null;
      }
    }

    const matchedUser = findMockUser(normalizedUsername, password);

    if (!matchedUser) {
      setError('Incorrect username or password.');
      setIsSubmitting(false);
      return;
    }

    const nextUser = {
      id: matchedUser.id,
      name: matchedUser.name,
      username: matchedUser.email,
      email: matchedUser.email,
      role: matchedUser.role,
      rawRole: matchedUser.role,
      access: matchedUser.access,
    };
    nextUser.isDemoReadOnly = isDemoReadOnlyUser(nextUser);

    try {
      await loginWithAppPassword(normalizedUsername, password, nextUser);
      rememberSuccessfulEmail();
      navigate('/dashboard', { replace: true });
    } catch (backendError) {
      setError(backendError.message || 'Unable to start backend admin session.');
      setIsSubmitting(false);
    }
  }

  async function requestPasswordReset() {
    if (isSubmitting || resetting) return;
    setError('');
    setNotice('');
    const email = username.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter your work email address first.');
      return;
    }
    if (!supabase || isDemoAuthEnabled) {
      setError('Password reset is unavailable here. Please contact your administrator.');
      return;
    }
    setResetting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('/set-password', window.location.origin).href,
      });
      if (resetError) throw resetError;
      setNotice('If an account exists for this email, a password reset link will be sent.');
    } catch {
      setError('Unable to request a reset right now. Please try again later or contact your administrator.');
    } finally {
      setResetting(false);
    }
  }

  const sessionMessage = String(location.state?.sessionMessage || '').trim();

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#101a4d_0%,#2444a4_62%,#3958a0_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_48%,rgba(15,23,42,0.34)_100%)]" />
      <section className="relative flex min-h-screen items-center justify-center px-5 py-8">
        <div className="w-full max-w-[460px]">
          <div className="mb-8 flex justify-center">
            <Logo className="h-12 w-12" textClassName="[&_p]:text-2xl [&_p]:text-white [&_span]:!text-white" />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-white/66 px-3 py-1.5 text-xs font-semibold text-qpms-700 ring-1 ring-qpms-100/80 backdrop-blur-xl">
              <Sparkles className="h-3.5 w-3.5" />
              Enterprise FM Operations
            </div>

            <div className="mt-8 text-center">
              <h2 className="text-[32px] font-semibold leading-tight tracking-normal text-slate-950 sm:text-[36px]">
                Welcome Back
              </h2>
              <p className="mx-auto mt-3 max-w-xs text-sm font-medium leading-6 text-slate-500">
                Sign in to continue to your operations workspace.
              </p>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Email</span>
                <span className="relative mt-2 block">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Enter your work email"
                    autoComplete="username"
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/82 pl-11 pr-4 text-sm font-medium text-slate-800 shadow-sm outline-none transition duration-200 placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-qpms-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(79,130,251,0.16),0_12px_30px_rgba(36,68,164,0.08)]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Password</span>
                <span className="relative mt-2 block">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/82 pl-11 pr-12 text-sm font-medium text-slate-800 shadow-sm outline-none transition duration-200 placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-qpms-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(79,130,251,0.16),0_12px_30px_rgba(36,68,164,0.08)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </span>
              </label>

              <div className="flex items-center justify-between gap-4">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <input
                    type="checkbox"
                    disabled={isSubmitting || resetting}
                    checked={rememberEmail}
                    onChange={(event) => {
                      setRememberEmail(event.target.checked);
                      if (!event.target.checked) {
                        try { localStorage.removeItem('qpms-remembered-email'); } catch { /* Storage unavailable. */ }
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-qpms-600 focus:ring-qpms-500"
                  />
                  Remember email
                </label>
                <button type="button" disabled={resetting || isSubmitting} onClick={requestPasswordReset} className="text-sm font-semibold text-qpms-600 transition hover:text-qpms-700 disabled:opacity-60">
                  {resetting ? 'Sending…' : 'Forgot password?'}
                </button>
              </div>

              {error || sessionMessage ? (
                <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {error || sessionMessage}
                </p>
              ) : null}

              {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
              <button
                type="submit"
                disabled={isSubmitting || resetting}
                className="focus-ring group flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-qpms-600 text-sm font-semibold text-white shadow-lg shadow-qpms-600/24 transition duration-200 hover:-translate-y-0.5 hover:bg-qpms-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:translate-y-0"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Verifying access
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-7 flex items-center justify-center gap-2 border-t border-slate-200/70 pt-5 text-xs font-medium text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Secure operational access enabled
            </div>
          </div>

          <div className="mt-7 text-center">
            <p className="text-xs font-semibold uppercase text-white">Connect</p>
            <div className="mt-3 flex justify-center gap-2">
              {socialLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target={item.href.startsWith('mailto:') ? undefined : '_blank'}
                  rel={item.href.startsWith('mailto:') ? undefined : 'noreferrer'}
                  aria-label={item.label}
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/16 bg-white/14 text-white shadow-sm backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/24 hover:text-white hover:shadow-[0_0_28px_rgba(147,197,253,0.30)]"
                >
                  <item.icon className="h-4.5 w-4.5" />
                </a>
              ))}
            </div>
            <div className="mt-5 text-xs font-semibold text-white">
              <Link className="underline decoration-white/30 underline-offset-4 transition hover:text-white" to="/account-deletion">
                Account Deletion Request
              </Link>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
