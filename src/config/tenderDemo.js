export const tenderDemoSessionKey = 'myqpms_tender_demo_session';

export const tenderDemoCredentials = Object.freeze({
  email: 'demo@myqpms.com',
  password: 'MyQPMS@Demo',
});

export function isTenderDemoModeEnabled(env = import.meta.env) {
  return String(env?.VITE_APP_ENV || '').trim().toLowerCase() === 'tender-demo'
    && String(env?.VITE_TENDER_DEMO || '').trim().toLowerCase() === 'true';
}

export function hasTenderDemoSession(storage = window.sessionStorage) {
  try {
    return storage.getItem(tenderDemoSessionKey) === 'active';
  } catch {
    return false;
  }
}

export function startTenderDemoSession(storage = window.sessionStorage) {
  storage.setItem(tenderDemoSessionKey, 'active');
}

export function endTenderDemoSession(storage = window.sessionStorage) {
  storage.removeItem(tenderDemoSessionKey);
}
