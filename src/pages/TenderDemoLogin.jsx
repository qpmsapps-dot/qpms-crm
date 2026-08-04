import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import {
  hasTenderDemoSession,
  isTenderDemoModeEnabled,
  startTenderDemoSession,
  tenderDemoCredentials,
} from '../config/tenderDemo.js';
import { usePageTitle } from '../hooks/usePageTitle.js';

export default function TenderDemoLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const demoEnabled = isTenderDemoModeEnabled();
  usePageTitle('Tender demo sign in');

  if (demoEnabled && hasTenderDemoSession()) {
    return <Navigate to="/demo/dashboard" replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!demoEnabled || isSubmitting) return;

    setError('');
    setIsSubmitting(true);
    window.setTimeout(() => {
      const validEmail = email.trim().toLowerCase() === tenderDemoCredentials.email;
      const validPassword = password === tenderDemoCredentials.password;

      if (!validEmail || !validPassword) {
        setError('Invalid demo login details.');
        setIsSubmitting(false);
        return;
      }

      startTenderDemoSession();
      navigate('/demo/dashboard', { replace: true });
    }, 420);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(219,234,254,0.85),transparent_26%),radial-gradient(circle_at_18%_76%,rgba(46,95,231,0.34),transparent_32%),linear-gradient(135deg,#101a4d_0%,#2444a4_38%,#eef4ff_100%)]" />
      <section className="relative flex min-h-screen items-center justify-center px-5 py-8">
        <div className="w-full max-w-[460px]">
          <div className="mb-8 flex justify-center">
            <Logo className="h-12 w-12" textClassName="[&_p]:text-2xl [&_p]:text-white" />
          </div>

          <div className="rounded-[2rem] border border-white/60 bg-white/82 p-6 shadow-[0_34px_120px_rgba(15,23,42,0.22)] ring-1 ring-qpms-200/30 backdrop-blur-3xl sm:p-8">
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-qpms-50 px-3 py-1.5 text-xs font-bold text-qpms-700 ring-1 ring-qpms-100">
              <Sparkles className="h-3.5 w-3.5" />
              Tender Presentation Sandbox
            </div>

            <div className="mt-8 text-center">
              <h1 className="text-[32px] font-semibold leading-tight text-slate-950 sm:text-[36px]">
                Demo Login
              </h1>
              <p className="mx-auto mt-3 max-w-sm text-sm font-medium leading-6 text-slate-500">
                Access a fictional interactive myQPMS workspace for client demonstrations.
              </p>
            </div>

            {!demoEnabled ? (
              <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                Tender demo mode is not enabled for this frontend build.
              </div>
            ) : (
              <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Email</span>
                  <span className="relative mt-2 block">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="demo@myqpms.com"
                      autoComplete="username"
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-medium text-slate-800 shadow-sm outline-none transition focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.16)]"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Password</span>
                  <span className="relative mt-2 block">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter demo password"
                      autoComplete="current-password"
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-12 text-sm font-medium text-slate-800 shadow-sm outline-none transition focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.16)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                </label>

                {error ? (
                  <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="focus-ring group flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-qpms-600 text-sm font-semibold text-white shadow-lg shadow-qpms-600/24 transition hover:bg-qpms-700 disabled:cursor-not-allowed disabled:opacity-80"
                >
                  {isSubmitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Opening demo
                    </>
                  ) : (
                    <>
                      Start Demo
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
            )}

            <div className="mt-7 flex items-center justify-center gap-2 border-t border-slate-200/70 pt-5 text-xs font-medium text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Frontend-only sample data. No production access.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
