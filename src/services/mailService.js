import { api, sendAuthenticatedLeadMom } from './api.js';

const mailRoutes = {
  leadMom: '/send-lead-mom',
  siteVisitMom: '/send-sitevisit-mom',
  proposal: '/send-proposal',
};

function getMailErrorMessage(error, route) {
  const status = error?.response?.status;
  const backendMessage = error?.response?.data?.message || error?.response?.data?.error;
  if (backendMessage) {
    return status ? `Mail API ${status}: ${backendMessage}` : backendMessage;
  }
  if (error?.code === 'ECONNABORTED') {
    return `Mail API request timed out for ${route}. Check VITE_API_URL and backend health.`;
  }
  if (error?.request && !error?.response) {
    return `Unable to reach myQPMS Mail API at ${api.defaults.baseURL || 'missing VITE_API_URL'}${route}. Check VITE_API_URL, Render backend status, and CORS origin.`;
  }
  return error?.message || 'Email failed';
}

function throwMailError(error, route) {
  const mailError = new Error(getMailErrorMessage(error, route));
  mailError.response = error?.response;
  mailError.request = error?.request;
  mailError.code = error?.code;
  throw mailError;
}

export async function sendLeadMomEmail(mom, lead) {
  try {
    return await sendAuthenticatedLeadMom({
      ...mom,
      leadId: lead?.id,
      clientName: lead?.company,
      company: lead?.company,
      primaryContact: lead?.contact,
      primaryContactEmail: lead?.email,
      serviceScope: mom?.serviceScope || lead?.serviceScope || lead?.service_scope || [],
      location: lead?.location,
      assignedBdExecutive: lead?.assigned_bd_executive || lead?.executive,
      assignedBdEmail: lead?.assigned_bd_email,
    });
  } catch (error) {
    throwMailError(error, mailRoutes.leadMom);
  }
}

export async function sendSiteVisitMomEmail(mom, visit) {
  try {
    const response = await api.post(mailRoutes.siteVisitMom, {
      ...mom,
      clientName: visit?.company,
      company: visit?.company,
    });
    return response.data;
  } catch (error) {
    throwMailError(error, mailRoutes.siteVisitMom);
  }
}

export async function sendProposalEmail(proposal, visit) {
  try {
    const response = await api.post(mailRoutes.proposal, {
      ...proposal,
      clientName: visit?.company,
      company: visit?.company,
      primaryContact: visit?.contact,
      primaryContactEmail: visit?.email,
      siteLocation: visit?.location,
    });
    return response.data;
  } catch (error) {
    if (error?.response?.status === 404) {
      throw new Error(`Proposal mail endpoint is not available on the backend yet. Expected POST ${mailRoutes.proposal} on VITE_API_URL.`);
    }
    throwMailError(error, mailRoutes.proposal);
  }
}
