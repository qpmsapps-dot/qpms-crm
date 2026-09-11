import { useEffect, useState } from 'react';
import { useAuth } from '../context/auth-context.js';
import { getHospitalTicketAccess } from '../services/hospitalTicketsApi.js';

export const NIMS_HOSPITAL_CLIENT_CODE = 'NIMS_HYDERABAD';

const accessCache = new Map();

function accessFailureMessage(error) {
  if (error?.response?.status === 403) {
    return error.response?.data?.message || 'Hospital ticket scope is not assigned.';
  }
  return 'Unable to verify Hospital Ticketing access.';
}

function loadAccess(userKey, presentation) {
  const cacheKey = `${userKey}:${presentation}`;
  const existing = accessCache.get(cacheKey);
  if (existing) return existing;
  const request = getHospitalTicketAccess({ client_code: NIMS_HOSPITAL_CLIENT_CODE, presentation })
    .then((result) => ({ allowed: result.allowed === true, client: result.client || null, error: '' }))
    .catch((error) => ({
      allowed: false,
      client: null,
      error: accessFailureMessage(error),
    }));
  accessCache.set(cacheKey, request);
  return request;
}

export function useHospitalTicketAccess(presentation = 'qpms') {
  const { user } = useAuth();
  const userKey = String(user?.id || user?.email || '');
  const [state, setState] = useState({ userKey: '', allowed: false, client: null, error: '' });

  useEffect(() => {
    let active = true;
    if (!userKey || user?.isDemoReadOnly) return undefined;
    loadAccess(userKey, presentation).then((result) => {
      if (active) setState({ userKey, ...result });
    });
    return () => {
      active = false;
    };
  }, [presentation, user?.isDemoReadOnly, userKey]);

  if (!userKey || user?.isDemoReadOnly) {
    return { loading: false, allowed: false, client: null, error: 'Hospital Ticketing access is not available for this account.' };
  }
  if (state.userKey !== userKey) return { loading: true, allowed: false, client: null, error: '' };
  return { loading: false, allowed: state.allowed, client: state.client, error: state.error };
}

export function clearHospitalTicketAccessCache() {
  accessCache.clear();
}
