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
import { motion as Motion } from 'framer-motion';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0 },
};

function initialsForName(name = '', email = '') {
  const source = String(name || email || '').trim();
  if (!source) return 'U';
  const cleaned = source.includes('@') ? source.split('@')[0] : source;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function LoginSuccessAvatar({ user }) {
  const [imageFailed, setImageFailed] = useState(false);
  const metadata = user?.metadata && typeof user.metadata === 'object' ? user.metadata : {};
  const avatarUrl =
    user?.profileImageUrl ||
    metadata.profile_image_url ||
    user?.profile_image_url ||
    user?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    '';
  const displayName = user?.displayName || user?.name || '';
  const initials = initialsForName(displayName, user?.email || user?.username || '');

  if (avatarUrl && !imageFailed) {
    return (
      <div className="mx-auto h-20 w-20 overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-[0_16px_36px_rgba(15,23,42,0.20)] ring-8 ring-qpms-50">
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-4 border-white bg-qpms-600 text-2xl font-black text-white shadow-[0_16px_36px_rgba(15,23,42,0.20)] ring-8 ring-qpms-50">
      {initials}
    </div>
  );
}

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWelcoming, setIsWelcoming] = useState(false);
  const [welcomeUser, setWelcomeUser] = useState(null);
  const navigate = useNavigate();
  const { loginWithAppPassword, loginWithPassword, isDemoAuthEnabled } = useAuth();
  usePageTitle('Sign in');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    const normalizedUsername = username.trim().toLowerCase();

    if (!isDemoAuthEnabled) {
      try {
        const nextUser = await loginWithPassword(normalizedUsername, password);
        setIsSubmitting(false);
        if (nextUser?.requiresPasswordChange) {
          navigate('/set-password', { replace: true });
          return nextUser;
        }
        setWelcomeUser(nextUser);
        setIsWelcoming(true);
        window.setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 900);
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

    window.setTimeout(() => {
      loginWithAppPassword(normalizedUsername, password, nextUser)
        .then(() => {
          setIsSubmitting(false);
          setWelcomeUser(nextUser);
          setIsWelcoming(true);

          window.setTimeout(() => {
            navigate('/dashboard', { replace: true });
          }, 1700);
        })
        .catch((backendError) => {
          setError(backendError.message || 'Unable to start backend admin session.');
          setIsSubmitting(false);
        });
    }, 650);
  }

  const matchedWelcomeUser = isDemoAuthEnabled ? findMockUser(username, password) : null;
  const activeWelcomeUser = welcomeUser || matchedWelcomeUser;
  const resolvedWelcomeName = activeWelcomeUser?.displayName || activeWelcomeUser?.name || '';
  const welcomeText = resolvedWelcomeName ? `Welcome Back, ${resolvedWelcomeName}` : 'Welcome Back';

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.76),transparent_24%),radial-gradient(circle_at_50%_28%,rgba(85,132,255,0.48),transparent_30%),radial-gradient(circle_at_20%_78%,rgba(23,54,140,0.40),transparent_34%),linear-gradient(135deg,#101a4d_0%,#2444a4_34%,#dbeafe_74%,#ffffff_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_48%,rgba(15,23,42,0.34)_100%)]" />
      <Motion.div
        animate={{ opacity: [0.28, 0.46, 0.28], scale: [1, 1.06, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute left-1/2 top-24 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-300/28 blur-3xl"
      />
      <Motion.div
        animate={{ opacity: [0.16, 0.32, 0.16], y: [0, -12, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-10 left-10 h-72 w-72 rounded-full bg-qpms-300/24 blur-3xl"
      />
      <div className="absolute right-16 top-20 h-96 w-96 rounded-full bg-white/58 blur-3xl" />

      <section className="relative flex min-h-screen items-center justify-center px-5 py-8">
        <Motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="w-full max-w-[460px]"
        >
          <div className="mb-8 flex justify-center">
            <Logo className="h-12 w-12" textClassName="[&_p]:text-2xl [&_p]:text-white" />
          </div>

          <Motion.div
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="rounded-[2rem] border border-white/60 bg-white/68 p-6 shadow-[0_34px_120px_rgba(15,23,42,0.22),inset_0_1px_0_rgba(255,255,255,0.70)] ring-1 ring-qpms-200/30 backdrop-blur-3xl sm:p-8"
          >
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-white/66 px-3 py-1.5 text-xs font-semibold text-qpms-700 ring-1 ring-qpms-100/80 backdrop-blur-xl">
              <Sparkles className="h-3.5 w-3.5" />
              Enterprise FM Operations
            </div>

            <div className="mt-8 text-center">
              <h2 className="text-[34px] font-semibold leading-tight tracking-normal text-slate-950 sm:text-[36px]">
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
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Type your mail id here"
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
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Type password here"
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
                    className="h-4 w-4 rounded border-slate-300 text-qpms-600 focus:ring-qpms-500"
                  />
                  Remember me
                </label>
                <button type="button" className="text-sm font-semibold text-qpms-600 transition hover:text-qpms-700">
                  Forgot password?
                </button>
              </div>

              {error ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
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
          </Motion.div>

          <div className="mt-7 text-center">
            <p className="text-xs font-semibold uppercase text-white/64">Connect</p>
            <div className="mt-3 flex justify-center gap-2">
              {socialLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target={item.href.startsWith('mailto:') ? undefined : '_blank'}
                  rel={item.href.startsWith('mailto:') ? undefined : 'noreferrer'}
                  aria-label={item.label}
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/16 bg-white/14 text-white/76 shadow-sm backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/24 hover:text-white hover:shadow-[0_0_28px_rgba(147,197,253,0.30)]"
                >
                  <item.icon className="h-4.5 w-4.5" />
                </a>
              ))}
            </div>
            <div className="mt-5 text-xs font-semibold text-white/70">
              <Link className="underline decoration-white/30 underline-offset-4 transition hover:text-white" to="/account-deletion">
                Account Deletion Request
              </Link>
            </div>
          </div>
          </Motion.div>
      </section>

      {isWelcoming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-5 backdrop-blur-sm">
          <div className="animate-[welcome-pop_260ms_ease-out] rounded-3xl border border-slate-200 bg-white px-8 py-7 text-center shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
            <LoginSuccessAvatar user={activeWelcomeUser} />
            <h2 className="mt-5 text-2xl font-bold tracking-normal text-slate-950">{welcomeText}</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">Opening your myQPMS workspace...</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
