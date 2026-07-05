import { ArrowRight, Check, Eye, EyeOff, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { completePasswordSetup } from '../services/api.js';

const expiredInviteMessage = 'Invite link is expired or not opened correctly. Please request a new invite.';
const genericPasswordError = 'Unable to create password. Please contact admin for a new invite.';
let inviteSessionBootstrapPromise = null;

function readInviteParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  for (const [key, value] of hashParams.entries()) {
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

function cleanInviteTokensFromUrl() {
  if (typeof window === 'undefined') return;
  const url = `${window.location.pathname}${window.location.search && !window.location.search.includes('access_token') && !window.location.search.includes('refresh_token') && !window.location.search.includes('code=') ? window.location.search : ''}`;
  window.history.replaceState({}, document.title, url || '/set-password');
}

function passwordSaveMessage(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('session') || message.includes('jwt') || message.includes('auth session missing')) {
    return expiredInviteMessage;
  }
  if (message.includes('expired') || message.includes('invalid') || message.includes('token')) {
    return expiredInviteMessage;
  }
  if (message.includes('password') && (message.includes('weak') || message.includes('short') || message.includes('least'))) {
    return 'Password must meet the minimum security requirement.';
  }
  return genericPasswordError;
}

export default function SetPassword() {
  usePageTitle('Set Password');
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      queueMicrotask(() => {
        setError('This invite link is invalid or expired. Please contact admin for a new invite.');
        setReady(true);
      });
      return undefined;
    }
    let active = true;
    async function establishInviteSession() {
      const params = readInviteParams();
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const code = params.get('code');
      const type = params.get('type');

      if (accessToken && refreshToken) {
        const { data, error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) throw setSessionError;
        if (import.meta.env.DEV) {
          console.info('[myQPMS SetPassword] Invite session established from tokens', { type });
        }
        cleanInviteTokensFromUrl();
        return data.session;
      }

      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
        if (import.meta.env.DEV) {
          console.info('[myQPMS SetPassword] Invite session established from code', { type });
        }
        cleanInviteTokensFromUrl();
        return data.session;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      return data.session;
    }

    inviteSessionBootstrapPromise ||= establishInviteSession();
    inviteSessionBootstrapPromise
      .then((session) => {
        if (!active) return;
        if (!session) {
          setError(expiredInviteMessage);
        }
        setReady(true);
      })
      .catch((sessionError) => {
        inviteSessionBootstrapPromise = null;
        if (!active) return;
        console.warn('[myQPMS SetPassword] Session verification failed', sessionError);
        setError(passwordSaveMessage(sessionError));
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        setError(expiredInviteMessage);
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      try {
        await completePasswordSetup();
      } catch (completeError) {
        console.warn('[myQPMS SetPassword] Profile completion sync failed', completeError);
        setError('Password was created, but profile status could not be updated. Please try again or contact admin.');
        return;
      }
      setMessage('Password created successfully. Please login to continue.');
      await supabase.auth.signOut();
      window.setTimeout(() => navigate('/login', { replace: true }), 900);
    } catch (saveError) {
      console.warn('[myQPMS SetPassword] Password update failed', saveError);
      setError(passwordSaveMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 py-8">
      <section className="w-full max-w-md rounded-3xl border border-white/20 bg-white p-7 shadow-[0_30px_90px_rgba(15,23,42,0.34)]">
        <div className="mb-6 flex justify-center">
          <Logo className="h-12 w-12" textClassName="[&_p]:text-2xl" />
        </div>
        <h1 className="text-center text-3xl font-black text-slate-950">Set Your Password</h1>
        <p className="mx-auto mt-2 max-w-xs text-center text-sm font-semibold text-slate-500">
          Create a private password for your myQPMS account.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">New Password</span>
            <span className="relative mt-2 block">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 pl-11 pr-12 text-sm font-semibold outline-none focus:border-qpms-300 focus:ring-4 focus:ring-qpms-100"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="focus-ring absolute right-2.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Confirm Password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-qpms-300 focus:ring-4 focus:ring-qpms-100"
              autoComplete="new-password"
            />
          </label>

          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p> : null}
          {message ? (
            <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
              <Check className="h-4 w-4" /> {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!ready || saving || Boolean(message)}
            className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-qpms-600 text-sm font-black text-white disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Set Password'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-5 text-center text-sm font-semibold text-slate-500">
          <Link to="/login" className="text-qpms-600 underline underline-offset-4">Back to login</Link>
        </div>
      </section>
    </main>
  );
}
