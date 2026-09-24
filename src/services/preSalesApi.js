import { authenticatedApiRequest } from './api.js';

async function request(config) {
  try {
    const response = await authenticatedApiRequest(config);
    return response.data;
  } catch (requestError) {
    const status = Number(requestError.response?.status || 0);
    const serverMessage = requestError.response?.data?.message;
    const message = status === 401
      ? 'Your session has expired. Please sign in again.'
      : status === 403
        ? 'You do not have permission to access this Pre-Sales record.'
        : serverMessage || 'Pre-Sales service is temporarily unavailable.';
    const error = new Error(message);
    error.status = status;
    error.code = requestError.response?.data?.code || 'PRE_SALES_REQUEST_FAILED';
    error.details = requestError.response?.data || null;
    throw error;
  }
}

export const getPreSalesDashboard = () => request({ method: 'GET', url: '/api/pre-sales/dashboard' });
export const getBdHandoffAssignees = () => request({ method: 'GET', url: '/api/pre-sales/bd-assignees' });
export const getPreSalesOwners = () => request({ method: 'GET', url: '/api/pre-sales/owners' });
export const getPreSalesLeads = (params = {}) => request({ method: 'GET', url: '/api/pre-sales/leads', params });
export const getPreSalesLead = (leadId) => request({ method: 'GET', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}` });
export const createPreSalesLead = (payload, idempotencyKey) => request({ method: 'POST', url: '/api/pre-sales/leads', data: payload, headers: { 'Idempotency-Key': idempotencyKey } });
export const updatePreSalesLead = (leadId, payload) => request({ method: 'PATCH', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}`, data: payload });
export const assignPreSalesOwner = (leadId, ownerProfileId) => request({ method: 'PATCH', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/owner`, data: { owner_profile_id: ownerProfileId } });
export const getCallHistory = (leadId) => request({ method: 'GET', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/call-history` });
export const addCallUpdate = (leadId, payload) => request({ method: 'POST', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/call-update`, data: payload });
export const getFollowups = (params = {}) => request({ method: 'GET', url: '/api/pre-sales/followups', params });
export const completeFollowup = (id, payload = {}) => request({ method: 'PATCH', url: `/api/pre-sales/followups/${encodeURIComponent(id)}/complete`, data: payload });
export const rescheduleFollowup = (id, payload) => request({ method: 'PATCH', url: `/api/pre-sales/followups/${encodeURIComponent(id)}/reschedule`, data: payload });
export const getMeetings = (leadId) => request({ method: 'GET', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/meetings` });
export const createMeeting = (leadId, payload) => request({ method: 'POST', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/meetings`, data: payload });
export const updateMeeting = (id, payload) => request({ method: 'PATCH', url: `/api/pre-sales/meetings/${encodeURIComponent(id)}`, data: payload });
export const getHandoffs = (leadId) => request({ method: 'GET', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/handoffs` });
export const createHandoff = (leadId, payload) => request({ method: 'POST', url: `/api/pre-sales/leads/${encodeURIComponent(leadId)}/handover`, data: payload });
