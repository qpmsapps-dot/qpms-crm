import axios from 'axios';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { assertDemoWriteAllowed } from '../utils/demoAccess.js';

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

async function adminApiRequest(config) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase Auth is not configured.');
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('An active Supabase session is required.');
  }
  try {
    const response = await api.request({
      ...config,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.data;
  } catch (requestError) {
    const status = requestError.response?.status;
    const serverMessage = requestError.response?.data?.message;
    if (status === 401) {
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

export function getAdminUsers(params = {}) {
  return adminApiRequest({
    method: 'GET',
    url: '/api/admin/users',
    params,
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

api.interceptors.request.use((config) => {
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
  }
  return config;
});
