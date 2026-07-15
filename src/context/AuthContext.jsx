import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { api, clearBackendToken, readBackendToken, setBackendToken } from '../services/api.js';
import { normalizeCanonicalRole } from '../utils/authRoles.js';
import {
  createDemoReadOnlyUser,
  isDemoReadOnlyCredentials,
  isDemoReadOnlyUser,
} from '../utils/demoAccess.js';
import { AuthContext } from './auth-context.js';

const authStorageKey = 'qpms-crm-auth-user';
const isDemoAuthEnabled =
  String(import.meta.env.VITE_ENABLE_DEMO_AUTH || '').trim().toLowerCase() === 'true';
const isProductionAuthMode = !isDemoAuthEnabled;

function readStoredUser() {
  if (typeof window === 'undefined') return null;

  try {
    const savedUser = window.localStorage.getItem(authStorageKey);
    return savedUser ? JSON.parse(savedUser) : null;
  } catch {
    return null;
  }
}

function isSetPasswordRoute() {
  return typeof window !== 'undefined' && window.location.pathname === '/set-password';
}

function profileToUser(profile, sessionUser) {
  if (!profile && !sessionUser) return null;
  const email = profile?.email || sessionUser?.email || '';
  const role = normalizeCanonicalRole(profile?.role || sessionUser?.user_metadata?.role || 'BD Executive');
  const metadata = profile?.metadata && typeof profile.metadata === 'object' ? profile.metadata : {};
  const authMetadata = sessionUser?.user_metadata || {};
  const emailPrefix = email ? email.split('@')[0] : '';
  const displayName =
    profile?.display_name ||
    profile?.full_name ||
    authMetadata.full_name ||
    authMetadata.name ||
    emailPrefix ||
    '';
  const profileImageUrl =
    metadata.profile_image_url ||
    profile?.profile_image_url ||
    profile?.avatar_url ||
    authMetadata.avatar_url ||
    '';
  const user = {
    id: profile?.auth_user_id || sessionUser?.id || profile?.id,
    profileId: profile?.id || '',
    name: displayName || email,
    displayName,
    username: email,
    email,
    role,
    rawRole: profile?.role || role,
    access: `${role} access`,
    isActive: profile ? Boolean(profile.is_active) : true,
    status: profile?.status || 'Active',
    webAccessEnabled: profile?.web_access_enabled === true,
    authProvider: 'supabase',
    requiresPasswordChange: profile?.requires_password_change === true,
    metadata,
    profileImageUrl,
  };
  return {
    ...user,
    isDemoReadOnly: isDemoReadOnlyUser(user),
  };
}

function validateWebProfile(profile) {
  if (!profile) {
    throw new Error('No profile is linked to this Supabase Auth user. Please contact Admin.');
  }
  if (String(profile.status || '').trim().toLowerCase() !== 'active') {
    throw new Error(`User access is ${profile.status || 'not active'}. Please contact Admin.`);
  }
  if (profile.is_active !== true) {
    throw new Error('This user profile is inactive. Please contact Admin.');
  }
  if (profile.web_access_enabled !== true) {
    throw new Error('Web access is disabled for this user. Please contact Admin.');
  }
}

async function fetchProfileForSession(session) {
  if (!session?.user || !supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Unable to load the linked user profile.');
  }

  validateWebProfile(data);
  return profileToUser(data, session.user);
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(readStoredUser);
  const [backendToken, setBackendTokenState] = useState(readBackendToken);
  const [authStatus, setAuthStatus] = useState(isProductionAuthMode ? 'loading' : 'ready');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const storedUser = readStoredUser();
    if (isDemoReadOnlyUser(storedUser)) {
      queueMicrotask(() => {
        setUserState(storedUser);
        setAuthStatus('ready');
        setAuthError('');
      });
      return undefined;
    }

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
        if (isSetPasswordRoute()) {
          setUserState(null);
          setAuthStatus('ready');
          setAuthError('');
          return;
        }
        void supabase.auth.signOut();
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
          if (isSetPasswordRoute()) {
            setUserState(null);
            setAuthStatus('ready');
            setAuthError('');
            return;
          }
          void supabase.auth.signOut();
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
    if (!isDemoAuthEnabled) {
      throw new Error('Demo backend authentication is disabled.');
    }

    // Legacy backend credentials are permitted only for explicit local demo mode.
    // The real Supabase login flow below never calls this function.
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
    const normalizedEmail = email.trim().toLowerCase();
    if (isDemoReadOnlyCredentials(normalizedEmail, password)) {
      if (import.meta.env.DEV) {
        console.info('Demo read-only login bypass activated');
      }
      const nextUser = createDemoReadOnlyUser(normalizedEmail);
      clearBackendToken();
      setBackendTokenState('');
      setUserState(nextUser);
      setAuthStatus('ready');
      setAuthError('');
      return nextUser;
    }

    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase Auth is not configured.');
    }

    setAuthStatus('loading');
    setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) {
      setAuthStatus('ready');
      setAuthError(error.message);
      throw error;
    }

    let nextUser;
    try {
      nextUser = await fetchProfileForSession(data.session);
    } catch (profileError) {
      await supabase.auth.signOut();
      setUserState(null);
      setAuthStatus('ready');
      setAuthError(profileError.message);
      throw profileError;
    }

    clearBackendToken();
    setBackendTokenState('');
    setUserState(nextUser);
    setAuthStatus('ready');
    return nextUser;
  }, []);

  const refreshUserProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const nextUser = await fetchProfileForSession(data.session);
    setUserState(nextUser);
    setAuthStatus('ready');
    setAuthError('');
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    if (isSupabaseConfigured && supabase && !isDemoReadOnlyUser(user)) {
      await supabase.auth.signOut();
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(authStorageKey);
    }
    clearBackendToken();
    setBackendTokenState('');
    setUserState(null);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loginBackend,
      loginWithAppPassword,
      loginWithPassword,
      refreshUserProfile,
      logout,
      authStatus,
      authError,
      isDemoAuthEnabled,
      isProductionAuthMode,
      backendToken,
    }),
    [user, setUser, loginBackend, loginWithAppPassword, loginWithPassword, refreshUserProfile, logout, authStatus, authError, backendToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
