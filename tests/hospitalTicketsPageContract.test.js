import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/pages/Tickets.jsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/hospitalTicketsApi.js', import.meta.url), 'utf8');

test('Tickets page uses live hospital ticket API instead of mock ticket data', () => {
  assert.match(page, /getHospitalTickets/);
  assert.match(page, /getHospitalTicketSummary/);
  assert.match(page, /getHospitalTicketDetail/);
  assert.doesNotMatch(page, /ticketMockData/);
  assert.doesNotMatch(page, /mockTickets/);
  assert.doesNotMatch(page, /featuredTicketDetails/);
});

test('Hospital ticket web API service targets read-only dashboard endpoints', () => {
  const dashboardApi = service.slice(0, service.indexOf('export async function getHospitalTicketNotifications'));
  assert.match(dashboardApi, /\/api\/web\/hospital-tickets\/summary/);
  assert.match(dashboardApi, /\/api\/web\/hospital-tickets/);
  assert.match(dashboardApi, /method:\s*'GET'/);
  assert.doesNotMatch(dashboardApi, /method:\s*'POST'/);
  assert.doesNotMatch(dashboardApi, /method:\s*'PATCH'/);
  assert.doesNotMatch(dashboardApi, /method:\s*'DELETE'/);
});

test('Tickets page exposes monitoring states required for live data', () => {
  for (const expected of ['Unassigned', 'Overdue', 'Reopened', 'Permission Required', 'Last refreshed']) {
    assert.match(page, new RegExp(expected));
  }
});
