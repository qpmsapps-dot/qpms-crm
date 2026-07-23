import { authenticatedApiRequest } from './api.js';

function dataOrThrow(response) {
  return response.data;
}

export async function getHospitalTicketSummary(params = {}) {
  return authenticatedApiRequest({
    method: 'GET',
    url: '/api/web/hospital-tickets/summary',
    params,
  }).then(dataOrThrow);
}

export async function getHospitalTickets(params = {}) {
  return authenticatedApiRequest({
    method: 'GET',
    url: '/api/web/hospital-tickets',
    params,
  }).then(dataOrThrow);
}

export async function getHospitalTicketDetail(ticketId) {
  return authenticatedApiRequest({
    method: 'GET',
    url: `/api/web/hospital-tickets/${encodeURIComponent(ticketId)}`,
  }).then(dataOrThrow);
}
