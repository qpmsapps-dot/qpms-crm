const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';
const DEFAULT_REFRESH_BACKOFF_MS = 30000;

export class AuthSessionError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE, code = 'SESSION_EXPIRED', cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AuthSessionError';
    this.code = code;
    this.isAuthSessionError = true;
  }
}

function responseStatus(response) {
  return Number(response?.status || 0);
}

export function createAuthSessionManager({
  client,
  now = () => Date.now(),
  refreshBackoffMs = DEFAULT_REFRESH_BACKOFF_MS,
} = {}) {
  let session = null;
  let bootstrapped = false;
  let bootstrapPromise = null;
  let refreshPromise = null;
  let refreshBlockedUntil = 0;
  let invalidating = false;
  const listeners = new Set();

  function publish(reason = null) {
    for (const listener of listeners) listener(session, reason);
  }

  function setSession(nextSession, reason = 'SESSION_UPDATED') {
    session = nextSession || null;
    bootstrapped = true;
    if (session) refreshBlockedUntil = 0;
    publish(reason);
    return session;
  }

  async function clearInvalidSession(reason = SESSION_EXPIRED_MESSAGE, cause = null) {
    session = null;
    bootstrapped = true;
    publish(reason);
    if (!client?.auth?.signOut || invalidating) return;
    invalidating = true;
    try {
      await client.auth.signOut({ scope: 'local' });
    } catch {
      // Local session state is already cleared; do not retry a failed sign-out.
    } finally {
      invalidating = false;
    }
    if (cause) throw cause;
  }

  function bootstrap() {
    if (bootstrapped) return Promise.resolve(session);
    if (bootstrapPromise) return bootstrapPromise;
    if (!client?.auth?.getSession) {
      return Promise.reject(new AuthSessionError('Supabase Auth is not configured.', 'AUTH_NOT_CONFIGURED'));
    }
    bootstrapPromise = client.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return setSession(data?.session || null, 'INITIAL_SESSION');
      })
      .finally(() => {
        bootstrapPromise = null;
      });
    return bootstrapPromise;
  }

  async function requireSession() {
    if (!bootstrapped) await bootstrap();
    if (!session?.access_token) {
      throw new AuthSessionError();
    }
    return session;
  }

  function sessionNeedsRefresh(value) {
    const expiresAtMs = Number(value?.expires_at || 0) * 1000;
    return expiresAtMs > 0 && expiresAtMs <= now() + 30000;
  }

  async function refresh({ staleAccessToken = null } = {}) {
    if (staleAccessToken && session?.access_token && session.access_token !== staleAccessToken) {
      return session;
    }
    if (refreshPromise) return refreshPromise;
    if (now() < refreshBlockedUntil) {
      throw new AuthSessionError(SESSION_EXPIRED_MESSAGE, 'REFRESH_BACKOFF');
    }
    if (!client?.auth?.refreshSession) {
      throw new AuthSessionError('Supabase Auth is not configured.', 'AUTH_NOT_CONFIGURED');
    }

    refreshPromise = client.auth.refreshSession()
      .then(async ({ data, error }) => {
        if (error || !data?.session?.access_token) {
          const status = Number(error?.status || error?.code || 0);
          if (status === 429) refreshBlockedUntil = now() + refreshBackoffMs;
          const authError = new AuthSessionError(
            SESSION_EXPIRED_MESSAGE,
            status === 429 ? 'REFRESH_RATE_LIMITED' : 'REFRESH_FAILED',
            error || null,
          );
          await clearInvalidSession(SESSION_EXPIRED_MESSAGE);
          throw authError;
        }
        return setSession(data.session, 'TOKEN_REFRESHED');
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  async function accessToken() {
    const activeSession = await requireSession();
    if (sessionNeedsRefresh(activeSession)) {
      return (await refresh({ staleAccessToken: activeSession.access_token })).access_token;
    }
    return activeSession.access_token;
  }

  async function authenticatedFetch(fetchImpl, input, init = {}) {
    const firstToken = await accessToken();
    const send = (token) => fetchImpl(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    let response = await send(firstToken);
    if (responseStatus(response) !== 401) return response;

    const refreshedSession = await refresh({ staleAccessToken: firstToken });
    response = await send(refreshedSession.access_token);
    if (responseStatus(response) === 401) {
      await clearInvalidSession(SESSION_EXPIRED_MESSAGE);
      throw new AuthSessionError();
    }
    return response;
  }

  return {
    bootstrap,
    setSession,
    clearInvalidSession,
    requireSession,
    accessToken,
    refresh,
    authenticatedFetch,
    getSession: () => session,
    isBootstrapped: () => bootstrapped,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let sharedManager = null;
let sharedClient = null;

export function configureAuthSession(client) {
  if (!sharedManager || sharedClient !== client) {
    sharedClient = client;
    sharedManager = createAuthSessionManager({ client });
  }
  return sharedManager;
}

export function authSessionManager() {
  if (!sharedManager) {
    throw new AuthSessionError('Supabase Auth has not finished initializing.', 'AUTH_NOT_INITIALIZED');
  }
  return sharedManager;
}

export function isAuthSessionError(error) {
  return error?.isAuthSessionError === true || error?.code === 'SESSION_EXPIRED';
}

export function isUnauthorizedError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return status === 401 || message.includes('invalid jwt') || message.includes('jwt expired');
}

export async function invalidateAuthOnUnauthorized(error) {
  if (!isUnauthorizedError(error)) return false;
  await authSessionManager().clearInvalidSession();
  return true;
}

export { SESSION_EXPIRED_MESSAGE };
