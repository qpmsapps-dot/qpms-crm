import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canAccessRoute, normalizeCanonicalRole } from '../src/utils/authRoles.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [routes, sidebar, page, api, guard, accessHook, dashboard] = await Promise.all([
  read('../src/routes/AppRoutes.jsx'),
  read('../src/components/Sidebar.jsx'),
  read('../src/pages/hospital-ticketing/NimsTicketingPage.jsx'),
  read('../src/services/hospitalTicketsApi.js'),
  read('../src/components/hospital-ticketing/HospitalTicketRouteGuard.jsx'),
  read('../src/hooks/useHospitalTicketAccess.js'),
  read('../src/pages/Dashboard.jsx'),
]);

test('Hospital Ticketing routes cover both views, drilldowns and legacy compatibility', () => {
  for (const path of [
    'hospital-ticketing/nims/qpms',
    'hospital-ticketing/nims/client',
    'hospital-ticketing/nims/qpms/tickets/:ticketId',
    'hospital-ticketing/nims/client/tickets/:ticketId',
    'tickets',
    'tickets/:ticketId',
  ]) assert.match(routes, new RegExp(`path: '${path.replaceAll('/', '\\/')}'`));
  assert.match(page, /hospital-ticketing\/nims\/\$\{view\}\/tickets\/\$\{encodeURIComponent\(ticket\.id\)\}/);
  assert.match(page, /LegacyHospitalTicketsRedirect/);
  assert.match(routes, /HospitalTicketRouteGuard/);
});

test('sidebar inserts the NIMS module after Demo Reviews and retains route filtering', () => {
  assert.match(sidebar, /title: 'Hospital Ticketing System'/);
  assert.match(sidebar, /label: 'NIMS Ticketing System', to: '\/hospital-ticketing\/nims\/qpms'/);
  assert.match(sidebar, /demoReviewsIndex \+ 1/);
  assert.match(sidebar, /hospitalAccess\.allowed \? insertHospitalTicketingGroup/);
  assert.match(sidebar, /canAccessNavRoute\(user, routePath\)/);
  assert.match(sidebar, /'\/tickets'/);
});

test('NIMS requests use the canonical client code and authenticated web APIs', () => {
  assert.match(accessHook, /NIMS_HOSPITAL_CLIENT_CODE = 'NIMS_HYDERABAD'/);
  assert.match(api, /authenticatedApiRequest/);
  for (const endpoint of [
    '/api/web/hospital-tickets/access',
    '/api/web/hospital-tickets/summary',
    '/api/web/hospital-tickets',
  ]) assert.match(api, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(page, /client_code: NIMS_HOSPITAL_CLIENT_CODE/);
  assert.match(guard, /if \(!access\.allowed\)/);
  assert.match(guard, /pathname\.includes\('\/client'\) \? 'client' : 'qpms'/);
  assert.match(accessHook, /presentation/);
});

test('QPMS and Client dashboards use live grouped statuses and real drilldowns', () => {
  for (const label of [
    'Total Tickets', 'Active Tickets', 'Awaiting Supervisor', 'Under Process',
    'Escalated', 'Awaiting Client Confirmation', 'SLA Breached', 'Closed', 'Cancelled',
    'Awaiting Your Feedback', 'Ticket Trend', 'Tickets by Status', 'Tickets by Category',
    'Ticket Ageing', 'Needs Attention', 'Recent / Active Tickets',
  ]) assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(page, /resolved_awaiting_confirmation/);
  assert.match(page, /escalated_hospital_dean/);
  assert.match(page, /setTimeout\(\(\) => setDebouncedSearch[\s\S]*350/);
  assert.doesNotMatch(page, /include_images/);
});

test('Client View omits internal panels while QPMS View renders them', () => {
  assert.match(page, /!clientView \? <Panel title="Assignment & Ownership"/);
  assert.match(page, /!clientView \? <Panel title="SLA & Performance"/);
  assert.match(page, /!clientView \? <Panel title="Comments \/ Notes"/);
  assert.match(page, /!clientView \? <Panel title="Assignment History"/);
  assert.match(page, /clientView \? 'Client View' : 'QPMS View'/);
});

test('web route capability defers Hospital Ticketing scope to the backend guard', () => {
  assert.equal(canAccessRoute({ role: 'Branch Head' }, '/hospital-ticketing/nims/qpms'), true);
  assert.equal(canAccessRoute({ role: 'Admin' }, '/hospital-ticketing/nims/qpms'), true);
  assert.equal(canAccessRoute({ role: 'Admin' }, '/hospital-ticketing/nims/client'), true);
  assert.equal(canAccessRoute(null, '/hospital-ticketing/nims/qpms'), false);
  assert.equal(normalizeCanonicalRole('Executive Assistant to COO'), 'Executive Assistant');
});

test('general dashboard links to live Hospital Ticketing instead of synthetic ticket KPIs', () => {
  assert.match(dashboard, /Hospital Ticketing/);
  assert.match(dashboard, /to="\/hospital-ticketing\/nims\/qpms"/);
  assert.doesNotMatch(dashboard, /<h2 className="command-title">Ticket Overview<\/h2>/);
});
