import { authenticatedApiRequest } from './api.js';

function dataOrThrow(response) {
  return response.data;
}

export async function getHospitalTicketAccess(params = {}) {
  return authenticatedApiRequest({
    method: 'GET',
    url: '/api/web/hospital-tickets/access',
    params,
  }).then(dataOrThrow);
}

export async function getHospitalTicketSummary(params = {}) {
  return authenticatedApiRequest({
    method: 'GET',
    url: '/api/web/hospital-tickets/summary',
    params,
  }).then(dataOrThrow);
}

export async function getHospitalClientContacts(params = {}) {
  return authenticatedApiRequest({
    method: 'GET',
    url: '/api/web/hospital-tickets/client-contacts',
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

export async function getHospitalTicketDetail(ticketId, params = {}) {
  return authenticatedApiRequest({
    method: 'GET',
    url: `/api/web/hospital-tickets/${encodeURIComponent(ticketId)}`,
    params,
  }).then(dataOrThrow);
}

export async function getHospitalTicketNotifications() {
  return authenticatedApiRequest({
    method: 'GET',
    url: '/api/hospital-tickets/notifications',
  }).then(dataOrThrow);
}

export async function markHospitalTicketNotificationRead(notificationId) {
  return authenticatedApiRequest({
    method: 'POST',
    url: `/api/hospital-tickets/notifications/${encodeURIComponent(notificationId)}/read`,
  }).then(dataOrThrow);
}
