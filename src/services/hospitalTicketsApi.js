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
