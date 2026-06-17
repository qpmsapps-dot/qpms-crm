import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { api, clearBackendToken, readBackendToken, setBackendToken } from '../services/api.js';
import { isProductionAuthMode, normalizeAppRole } from '../utils/authRoles.js';
import { AuthContext } from './auth-context.js';

const authStorageKey = 'qpms-crm-auth-user';

function readStoredUser() {
  if (typeof window === 'undefined') return null;

  try {
    const savedUser = window.localStorage.getItem(authStorageKey);
    return savedUser ? JSON.parse(savedUser) : null;
  } catch {
    return null;
  }
}

function profileToUser(profile, sessionUser) {
  if (!profile && !sessionUser) return null;
  const email = profile?.email || sessionUser?.email || '';
  const role = normalizeAppRole(profile?.role || sessionUser?.user_metadata?.role || 'BD');
  return {
    id: profile?.auth_user_id || sessionUser?.id || profile?.id,
    profileId: profile?.id || '',
    name: profile?.full_name || sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || email,
    username: email,
    email,
    role,
    rawRole: profile?.role || role,
    access: `${role} access`,
    isActive: profile ? Boolean(profile.is_active) : true,
    status: profile?.status || 'Active',
    authProvider: 'supabase',
  };
}

async function fetchProfileForSession(session) {
  if (!session?.user || !supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.warn('[myQPMS Auth] Profile fetch failed', error);
    return profileToUser(null, session.user);
  }

  if (data) {
    await supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.id);
    return profileToUser(data, session.user);
  }

  return profileToUser(null, session.user);
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(readStoredUser);
  const [backendToken, setBackendTokenState] = useState(readBackendToken);
  const [authStatus, setAuthStatus] = useState(isProductionAuthMode ? 'loading' : 'ready');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (isProductionAuthMode && !isSupabaseConfigured) {
      queueMicrotask(() => {
        setAuthStatus('error');
        setAuthError('Supabase Auth is required in production mode.');
        setUserState(null);
      });
      return undefined;
    }

    if (!isSupabaseConfigured || !supabase) {
      queueMicrotask(() => setAuthStatus('ready'));
      return undefined;
    }

    let active = true;
    queueMicrotask(() => {
      if (active) setAuthStatus('loading');
    });

    supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        const nextUser = await fetchProfileForSession(data.session);
        if (!active) return;
        setUserState(nextUser);
        setAuthStatus('ready');
        setAuthError('');
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[myQPMS Auth] Session restore failed', error);
        setUserState(null);
        setAuthStatus(isProductionAuthMode ? 'error' : 'ready');
        setAuthError(error.message || 'Session restore failed');
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (!active) return;
        setUserState(null);
        setAuthStatus('ready');
        setAuthError('');
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(authStorageKey);
          clearBackendToken();
          setBackendTokenState('');
        }
        return;
      }
      fetchProfileForSession(session)
        .then((nextUser) => {
          if (!active) return;
          setUserState(nextUser);
          setAuthStatus('ready');
          setAuthError('');
        })
        .catch((error) => {
          if (!active) return;
          console.warn('[myQPMS Auth] Auth state profile sync failed', error);
          setUserState(null);
          setAuthStatus(isProductionAuthMode ? 'error' : 'ready');
          setAuthError(error.message || 'Profile sync failed');
        });
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user) {
      window.localStorage.removeItem(authStorageKey);
      return;
    }

    window.localStorage.setItem(authStorageKey, JSON.stringify(user));
  }, [user]);

  const setUser = useCallback((nextUser) => {
    if (isProductionAuthMode) {
      console.warn('[myQPMS Auth] Mock setUser ignored in production mode');
      return;
    }
    setUserState(nextUser);
  }, []);

  const loginBackend = useCallback(async (email, password) => {
    const response = await api.post('/api/auth/login', {
      email: email.trim().toLowerCase(),
      password,
    });
    const token = response.data?.token || '';
    if (!token) throw new Error('Backend login did not return an API token.');
    setBackendToken(token);
    setBackendTokenState(token);
    return response.data;
  }, []);

  const loginWithAppPassword = useCallback(async (email, password, nextUser) => {
    await loginBackend(email, password);
    setUser(nextUser);
    return nextUser;
  }, [loginBackend, setUser]);

  const loginWithPassword = useCallback(async (email, password) => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase Auth is not configured.');
    }

    setAuthStatus('loading');
    setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setAuthStatus('ready');
      setAuthError(error.message);
      throw error;
    }

    const nextUser = await fetchProfileForSession(data.session);
    if (!nextUser?.isActive && nextUser?.role !== 'Admin') {
      await supabase.auth.signOut();
      setUserState(null);
      setAuthStatus('ready');
      throw new Error(`User access is ${nextUser?.status || 'not active'}. Please contact Admin.`);
    }

    await loginBackend(email, password);
    setUserState(nextUser);
    setAuthStatus('ready');
    return nextUser;
  }, [loginBackend]);

  const logout = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(authStorageKey);
    }
    clearBackendToken();
    setBackendTokenState('');
    setUserState(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loginBackend,
      loginWithAppPassword,
      loginWithPassword,
      logout,
      authStatus,
      authError,
      isProductionAuthMode,
      backendToken,
    }),
    [user, setUser, loginBackend, loginWithAppPassword, loginWithPassword, logout, authStatus, authError, backendToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
