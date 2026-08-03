import { Buffer } from 'node:buffer';
import process from 'node:process';

import admin from 'firebase-admin';

let initializedApp = null;
let warnedUnavailable = false;

function parseServiceAccount(environment = process.env) {
  const encoded = String(environment.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (encoded) {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return normalizeServiceAccount(json);
  }
  const projectId = String(environment.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(environment.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(environment.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return normalizeServiceAccount({
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  });
}

function normalizeServiceAccount(value) {
  return {
    projectId: value.project_id || value.projectId,
    clientEmail: value.client_email || value.clientEmail,
    privateKey: String(value.private_key || value.privateKey || '').replace(/\\n/g, '\n'),
  };
}

export function firebaseAdminStatus(environment = process.env) {
  try {
    const account = parseServiceAccount(environment);
    return {
      configured: Boolean(account?.projectId && account?.clientEmail && account?.privateKey),
      project_id: account?.projectId || null,
    };
  } catch (error) {
    return { configured: false, project_id: null, error: error?.message || 'invalid_firebase_config' };
  }
}

export function getFirebaseMessaging(environment = process.env) {
  if (initializedApp) return admin.messaging(initializedApp);
  const account = parseServiceAccount(environment);
  if (!account?.projectId || !account?.clientEmail || !account?.privateKey) {
    if (!warnedUnavailable) {
      console.warn('[Hospital Push] Firebase Admin is not configured; push delivery will be skipped.');
      warnedUnavailable = true;
    }
    return null;
  }
  initializedApp = admin.apps.find((app) => app.name === 'hospital-ticketing')
    || admin.initializeApp({
      credential: admin.credential.cert(account),
      projectId: account.projectId,
    }, 'hospital-ticketing');
  console.log('[Hospital Push] Firebase Admin initialized', { project_id: account.projectId });
  return admin.messaging(initializedApp);
}

export async function sendFirebaseMessage(message, { messaging = getFirebaseMessaging() } = {}) {
  if (!messaging) {
    return { ok: false, skipped: true, code: 'firebase_unconfigured', retryable: true };
  }
  try {
    const messageId = await messaging.send(message);
    return { ok: true, messageId };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      code: error?.code || 'firebase_send_failed',
      message: error?.message || 'Firebase send failed.',
      retryable: isRetryableFirebaseError(error?.code),
    };
  }
}

export function isInvalidFirebaseTokenError(code) {
  return [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
  ].includes(String(code || ''));
}

export function isRetryableFirebaseError(code) {
  const key = String(code || '');
  if (isInvalidFirebaseTokenError(key)) return false;
  return ![
    'messaging/mismatched-credential',
    'messaging/authentication-error',
    'messaging/invalid-apns-credentials',
  ].includes(key);
}
