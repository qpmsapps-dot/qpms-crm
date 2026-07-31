import axios from 'axios';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { assertDemoWriteAllowed } from '../utils/demoAccess.js';
import { authSessionManager, AuthSessionError } from './authSession.js';

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ||
  'http://localhost:4000';
const backendTokenStorageKey = 'qpms-crm-backend-token';

console.log('[myQPMS Mail API] Using API base:', API_BASE);

export function readBackendToken() {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(backendTokenStorageKey) || '';
}

export function setBackendToken(token) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.sessionStorage.setItem(backendTokenStorageKey, token);
  } else {
    window.sessionStorage.removeItem(backendTokenStorageKey);
  }
}

export function clearBackendToken() {
  setBackendToken('');
}

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const publicApi = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function authenticatedApiRequest(config) {
  const backendToken = readBackendToken();
  if (backendToken) {
    return api.request({
      ...config,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${backendToken}`,
      },
    });
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase Auth is not configured.');
  }
  const manager = authSessionManager();
  const accessToken = await manager.accessToken();
  return api.request({
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function authenticatedFetch(input, init = {}) {
  const method = String(init?.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    assertDemoWriteAllowed();
  }
  const backendToken = readBackendToken();
  if (backendToken) {
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${backendToken}`,
      },
    });
  }
  return authSessionManager().authenticatedFetch(fetch, input, init);
}

async function adminApiRequest(config) {
  try {
    const response = await authenticatedApiRequest(config);
    return response.data;
  } catch (requestError) {
    const status = requestError.response?.status;
    const serverMessage = requestError.response?.data?.message;
    if (status === 401 || requestError.isAuthSessionError) {
      throw new Error(serverMessage || 'Your Supabase session has expired. Sign in again.');
    }
    if (status === 403) {
      throw new Error(serverMessage || 'Your profile does not have User Management permission.');
    }
    if (status === 503) {
      throw new Error(
        serverMessage ||
          'User Management backend access is unavailable. Check the server Supabase service-role configuration.',
      );
    }
    if (status === 404 && String(config.url || '').includes('/api/profile/me')) {
      throw new Error('Profile update route not available. Please redeploy backend or contact admin.');
    }
    throw requestError;
  }
}

export function getAdminUserMe() {
  return adminApiRequest({
    method: 'GET',
    url: '/api/admin/users/me',
  });
}

async function leadApiRequest(config) {
  try {
    const response = await authenticatedApiRequest(config);
    return response.data;
  } catch (requestError) {
    const status = requestError.response?.status;
    const authCode = String(requestError?.code || '');
    let message = 'Unable to load Lead Management data. Please retry.';
    if (
      status === 401
      || (requestError.isAuthSessionError
        && ['SESSION_EXPIRED', 'REFRESH_FAILED'].includes(authCode))
    ) {
      message = 'Your session has expired. Please sign in again.';
    }
    if (status === 403) {
      message = 'You do not have permission to access Lead Management.';
    }
    if (status === 404) {
      message = 'Lead Management service is unavailable.';
    }
    const error = new Error(message);
    error.status = Number(status || 0);
    error.code = authCode || 'LEAD_MANAGEMENT_REQUEST_FAILED';
    error.isLeadManagementRequestError = true;
    throw error;
  }
}

export function getMyAccess(params = {}) {
  return adminApiRequest({
    method: 'GET',
    url: '/api/access/me',
    params,
  });
}

export function getAccessFoundation() {
  return adminApiRequest({
    method: 'GET',
    url: '/api/access/foundation',
  });
}

export function getAccessScopeOptions(params = {}) {
  return adminApiRequest({
    method: 'GET',
    url: '/api/access/scope-options',
    params,
  });
}

export function getMyProfile() {
  return adminApiRequest({
    method: 'GET',
    url: '/api/profile/me',
  });
}

export function updateMyProfile(payload) {
  return adminApiRequest({
    method: 'PUT',
    url: '/api/profile/me',
    data: payload,
  });
}

export function createProfileAvatarUpload(payload) {
  return adminApiRequest({
    method: 'POST',
    url: '/api/profile/avatar',
    data: payload,
  });
}

export function completePasswordSetup() {
  return adminApiRequest({
    method: 'POST',
    url: '/api/profile/password-setup-complete',
  });
}

export function getAdminUsers(params = {}) {
  return adminApiRequest({
    method: 'GET',
    url: '/api/admin/users',
    params,
  });
}

export function getAdminUsersHierarchy() {
  return adminApiRequest({
    method: 'GET',
    url: '/api/admin/users/hierarchy',
  });
}

export function getAdminUser(profileId) {
  return adminApiRequest({
    method: 'GET',
    url: `/api/admin/users/${encodeURIComponent(profileId)}`,
  });
}

export function syncAuthUsersToProfiles() {
  return adminApiRequest({
    method: 'POST',
    url: '/api/admin/users/sync-auth-to-profiles',
  });
}

export function createAdminUser(payload) {
  return adminApiRequest({
    method: 'POST',
    url: '/api/admin/users',
    data: payload,
  });
}

export function getHierarchyOptions(params = {}) {
  return adminApiRequest({
    method: 'GET',
    url: '/api/users/hierarchy-options',
    params,
  });
}

export function enableLoginAccess(employeeCode, payload = {}) {
  return adminApiRequest({
    method: 'POST',
    url: `/api/admin/users/${encodeURIComponent(employeeCode)}/enable-login`,
    data: payload,
  });
}

export function updateAdminUser(profileId, payload) {
  return adminApiRequest({
    method: 'PATCH',
    url: `/api/admin/users/${encodeURIComponent(profileId)}`,
    data: payload,
  });
}

export function deactivateAdminUser(profileId, payload) {
  return adminApiRequest({
    method: 'POST',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/deactivate`,
    data: payload,
  });
}

export function reactivateAdminUser(profileId, payload) {
  return adminApiRequest({
    method: 'POST',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/reactivate`,
    data: payload,
  });
}

export function resetAdminUserPassword(profileId, payload) {
  return adminApiRequest({
    method: 'POST',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/reset-password`,
    data: payload,
  });
}

export function getHardDeletePreview(profileId) {
  return adminApiRequest({
    method: 'GET',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/hard-delete-preview`,
  });
}

export function hardDeleteAdminUser(profileId, payload) {
  return adminApiRequest({
    method: 'DELETE',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/hard-delete`,
    data: payload,
  });
}

export function previewEmployeeCodeRepair(profileId, payload) {
  return adminApiRequest({
    method: 'POST',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/repair-employee-code-preview`,
    data: payload,
  });
}

export function repairEmployeeCode(profileId, payload) {
  return adminApiRequest({
    method: 'POST',
    url: `/api/admin/users/${encodeURIComponent(profileId)}/repair-employee-code`,
    data: payload,
  });
}

export function getStoreMaster(params = {}) {
  return adminApiRequest({
    method: 'GET',
    url: '/api/store-master',
    params,
  });
}

export function getStoreMasterRecord(id) {
  return adminApiRequest({
    method: 'GET',
    url: `/api/store-master/${encodeURIComponent(id)}`,
  });
}

export function createStoreMasterRecord(payload) {
  return adminApiRequest({
    method: 'POST',
    url: '/api/store-master',
    data: payload,
  });
}

export function updateStoreMasterRecord(id, payload) {
  return adminApiRequest({
    method: 'PATCH',
    url: `/api/store-master/${encodeURIComponent(id)}`,
    data: payload,
  });
}

export function getLeadManagementLeads(params = {}) {
  return leadApiRequest({
    method: 'GET',
    url: '/api/lead-management/leads',
    params,
  });
}

export function getLeadManagementLead(leadId) {
  return leadApiRequest({
    method: 'GET',
    url: `/api/lead-management/leads/${encodeURIComponent(leadId)}`,
  });
}

export function createLeadManagementLead(payload, idempotencyKey) {
  return leadApiRequest({
    method: 'POST',
    url: '/api/lead-management/leads',
    data: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function updateLeadManagementLead(leadId, payload) {
  return leadApiRequest({
    method: 'PATCH',
    url: `/api/lead-management/leads/${encodeURIComponent(leadId)}`,
    data: payload,
  });
}

export function sendAuthenticatedLeadMom(payload) {
  return leadApiRequest({
    method: 'POST',
    url: '/send-lead-mom',
    data: payload,
  });
}

export function saveAuthenticatedLeadMomDraft(leadId, payload) {
  return leadApiRequest({
    method: 'POST',
    url: `/api/lead-management/leads/${encodeURIComponent(leadId)}/mom`,
    data: payload,
  });
}

export function getLeadManagementAssignees() {
  return leadApiRequest({
    method: 'GET',
    url: '/api/lead-management/assignees',
  });
}

async function hospitalFeedbackQrRequest(config) {
  try {
    const response = await authenticatedApiRequest(config);
    return response.data;
  } catch (requestError) {
    const status = requestError.response?.status;
    const serverMessage = requestError.response?.data?.message;
    if (status === 401 || requestError.isAuthSessionError) {
      throw new Error(serverMessage || 'Your session has expired. Please sign in again.');
    }
    if (status === 403) {
      throw new Error(serverMessage || 'You do not have permission to generate Hospital Feedback QR codes.');
    }
    throw new Error(serverMessage || 'Unable to complete Hospital Feedback QR request.');
  }
}

export async function getHospitalFeedbackQrLocations() {
  const data = await hospitalFeedbackQrRequest({
    method: 'GET',
    url: '/api/hospital-feedback/qr/locations',
  });
  return data.locations || [];
}

export async function generateHospitalFeedbackQr(locationId) {
  const data = await hospitalFeedbackQrRequest({
    method: 'POST',
    url: '/api/hospital-feedback/qr',
    data: { location_id: locationId },
  });
  return data.qr;
}

export async function resolvePublicHospitalFeedbackQr(token) {
  const response = await publicApi.get(`/api/public/hospital-feedback/qr/${encodeURIComponent(token)}`);
  return response.data;
}

export async function verifyPublicHospitalFeedbackSession(sessionToken) {
  const response = await publicApi.get(`/api/public/hospital-feedback/session/${encodeURIComponent(sessionToken)}`);
  return response.data;
}

api.interceptors.request.use(async (config) => {
  if (!API_BASE) {
    return Promise.reject(
      new Error('VITE_API_URL is missing.')
    );
  }
  const method = String(config.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    assertDemoWriteAllowed();
  }
  const token = readBackendToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  } else if (!config.headers.Authorization && !String(config.url || '').includes('/api/auth/login')) {
    config.headers.Authorization = `Bearer ${await authSessionManager().accessToken()}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    if (error.response?.status !== 401 || String(config.url || '').includes('/api/auth/login')) {
      return Promise.reject(error);
    }
    if (config._authRetry === true) {
      await authSessionManager().clearInvalidSession();
      return Promise.reject(new AuthSessionError());
    }
    config._authRetry = true;
    const staleAccessToken = String(config.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    const refreshedSession = await authSessionManager().refresh({ staleAccessToken });
    config.headers = {
      ...(config.headers || {}),
      Authorization: `Bearer ${refreshedSession.access_token}`,
    };
    return api.request(config);
  },
);
