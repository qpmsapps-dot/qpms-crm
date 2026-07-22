import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { api, clearBackendToken, readBackendToken, setBackendToken } from '../services/api.js';
import { normalizeCanonicalRole } from '../utils/authRoles.js';
import {
  createDemoReadOnlyUser,
  isDemoReadOnlyCredentials,
  isDemoReadOnlyUser,
} from '../utils/demoAccess.js';
import { AuthContext } from './auth-context.js';
import {
  authSessionManager,
  configureAuthSession,
  SESSION_EXPIRED_MESSAGE,
} from '../services/authSession.js';

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
    is_demo: profile?.is_demo === true || metadata.is_demo === true,
    read_only: profile?.read_only === true || metadata.read_only === true,
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
  const [session, setSessionState] = useState(null);
  const [backendToken, setBackendTokenState] = useState(readBackendToken);
  const [authStatus, setAuthStatus] = useState(isProductionAuthMode ? 'loading' : 'ready');
  const [authError, setAuthError] = useState('');
  const intentionalSignOutRef = useRef(false);

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
    const manager = configureAuthSession(supabase);
    queueMicrotask(() => {
      if (active) setAuthStatus('loading');
    });

    const unsubscribeManager = manager.subscribe((nextSession, reason) => {
      if (!active) return;
      setSessionState(nextSession);
      if (!nextSession && reason === SESSION_EXPIRED_MESSAGE) {
        setUserState(null);
        setAuthStatus('ready');
        setAuthError(SESSION_EXPIRED_MESSAGE);
        window.localStorage.removeItem(authStorageKey);
        clearBackendToken();
        setBackendTokenState('');
      }
    });

    manager.bootstrap()
      .then(async (nextSession) => {
        if (!active) return;
        setSessionState(nextSession);
        const nextUser = await fetchProfileForSession(nextSession);
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
        void manager.clearInvalidSession(error.message || 'Session restore failed');
        setSessionState(null);
        setUserState(null);
        setAuthStatus(isProductionAuthMode ? 'error' : 'ready');
        setAuthError(error.message || 'Session restore failed');
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (!active) return;
        const preserveSessionError = manager.getSession() === null;
        const intentionalSignOut = intentionalSignOutRef.current || isSetPasswordRoute();
        intentionalSignOutRef.current = false;
        manager.setSession(null, 'SIGNED_OUT');
        setSessionState(null);
        setUserState(null);
        setAuthStatus('ready');
        if (!preserveSessionError) {
          setAuthError(intentionalSignOut ? '' : SESSION_EXPIRED_MESSAGE);
        }
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(authStorageKey);
          clearBackendToken();
          setBackendTokenState('');
        }
        return;
      }
      if (event === 'INITIAL_SESSION') return;
      manager.setSession(session, event);
      setSessionState(session || null);
      if (event === 'TOKEN_REFRESHED') {
        if (active) {
          setAuthStatus('ready');
          setAuthError('');
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
          void manager.clearInvalidSession(error.message || 'Profile sync failed');
          setSessionState(null);
          setUserState(null);
          setAuthStatus(isProductionAuthMode ? 'error' : 'ready');
          setAuthError(error.message || 'Profile sync failed');
        });
    });

    return () => {
      active = false;
      unsubscribeManager();
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

    if (!isSupabaseConfigured || !supabase) {
      if (isDemoReadOnlyCredentials(normalizedEmail, password) && isDemoAuthEnabled) {
        const backendLogin = await loginBackend(normalizedEmail, password);
        const nextUser = {
          ...createDemoReadOnlyUser(normalizedEmail),
          backendToken: backendLogin.token || '',
        };
        setUserState(nextUser);
        setAuthStatus('ready');
        setAuthError('');
        return nextUser;
      }
      throw new Error('Supabase Auth is not configured.');
    }

    setAuthStatus('loading');
    setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) {
      if (isDemoReadOnlyCredentials(normalizedEmail, password) && isDemoAuthEnabled) {
        const backendLogin = await loginBackend(normalizedEmail, password);
        const nextUser = {
          ...createDemoReadOnlyUser(normalizedEmail),
          backendToken: backendLogin.token || '',
        };
        configureAuthSession(supabase).setSession(null, 'DEMO_BACKEND_SIGNED_IN');
        setSessionState(null);
        setUserState(nextUser);
        setAuthStatus('ready');
        setAuthError('');
        return nextUser;
      }
      setAuthStatus('ready');
      setAuthError(error.message);
      throw error;
    }
    configureAuthSession(supabase).setSession(data.session, 'SIGNED_IN');
    setSessionState(data.session || null);

    let nextUser;
    try {
      nextUser = await fetchProfileForSession(data.session);
    } catch (profileError) {
      intentionalSignOutRef.current = true;
      await supabase.auth.signOut();
      configureAuthSession(supabase).setSession(null, 'SIGNED_OUT');
      setSessionState(null);
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
  }, [loginBackend]);

  const refreshUserProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return null;
    const activeSession = await authSessionManager().requireSession();
    const nextUser = await fetchProfileForSession(activeSession);
    setSessionState(activeSession);
    setUserState(nextUser);
    setAuthStatus('ready');
    setAuthError('');
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    if (isSupabaseConfigured && supabase && !isDemoReadOnlyUser(user)) {
      intentionalSignOutRef.current = true;
      await supabase.auth.signOut();
    }
    if (isSupabaseConfigured && supabase) {
      configureAuthSession(supabase).setSession(null, 'SIGNED_OUT');
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(authStorageKey);
    }
    clearBackendToken();
    setBackendTokenState('');
    setSessionState(null);
    setUserState(null);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      session,
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
    [user, session, setUser, loginBackend, loginWithAppPassword, loginWithPassword, refreshUserProfile, logout, authStatus, authError, backendToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
