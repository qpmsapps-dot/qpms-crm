import axios from 'axios';

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

api.interceptors.request.use((config) => {
  if (!API_BASE) {
    return Promise.reject(
      new Error('VITE_API_URL is missing.')
    );
  }
  const token = readBackendToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
