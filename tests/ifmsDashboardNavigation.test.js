import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canAccessRoute, retailWebAccess } from '../src/utils/authRoles.js';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const routes = read('src/routes/AppRoutes.jsx');
const sidebar = read('src/components/Sidebar.jsx');
const dashboard = read('src/pages/reliance-retail/RetailDashboard.jsx');

test('existing Retail dashboard and detail routes resolve within the existing shell', () => {
  assert.match(routes, /import RetailDashboard from '..\/pages\/reliance-retail\/RetailDashboard.jsx'/);
  assert.match(routes, /path: 'reliance-retail', element: <RetailDashboard/);
  for (const route of ['attendance','deep-cleaning','training']) assert.ok(routes.includes(`path: 'reliance-retail/${route}'`));
  assert.match(routes, /element: <MainLayout/);
});
test('Retail Fault Tracker redirects to the existing IFMS import dashboard, preserving its original component',()=>{
  assert.match(routes,/path: 'fault-tracker', element: <FaultTracker \/>/);
  assert.match(routes,/path: 'reliance-retail\/fault-tracker', element: <Navigate to="\/fault-tracker" replace \/>/);
  assert.doesNotMatch(routes,/path: 'reliance-retail\/fault-tracker', element: <RetailOperationalTrackers/);
  const group=sidebar.slice(sidebar.indexOf('const relianceRetailNavGroup'),sidebar.indexOf('function insertHospitalTicketingGroup'));
  assert.match(group,/label: 'Fault Tracker', to: '\/fault-tracker'/);
});
test('Retail sidebar retains its ordered existing navigation and access gate', () => {
  const group = sidebar.slice(sidebar.indexOf('const relianceRetailNavGroup'),sidebar.indexOf('function insertHospitalTicketingGroup'));
  let previous = -1;
  for (const label of ['Dashboard','Attendance','Deep Cleaning','HK & MEPC Training','CM/PM','Thermography','Fault Tracker','OOS Tracker','Manpower Vacancy','Reliance Retail Store Master']) {
    const index=group.indexOf(`label: '${label}'`);assert.ok(index>previous,label);previous=index;
  }
  assert.match(sidebar,/retailWebAccess\(user\)\.dashboard/);
});
test('dashboard preserves role boundaries and existing detail-route authorization', () => {
  const hk={role:'MIS',designation:'HK MIS',business:'Reliance Retail'};
  const technical={...hk,designation:'Technical MIS'};
  const kam={role:'KAM',business:'Reliance Retail'};
  for (const user of [hk,technical,kam]) assert.equal(canAccessRoute(user,'/reliance-retail'),true);
  assert.equal(canAccessRoute(null,'/reliance-retail'),false);
  assert.equal(retailWebAccess({...hk,business:'Other'}).dashboard,false);
  assert.equal(canAccessRoute({role:'DEMO_VIEWER'},'/reliance-retail'),false);
  assert.equal(canAccessRoute(technical,'/reliance-retail/training'),false);
  assert.equal(canAccessRoute(technical,'/reliance-retail/deep-cleaning'),false);
  assert.equal(canAccessRoute(hk,'/reliance-retail/training'),true);
  assert.match(dashboard,/canAccessRoute\(user, route\)/);
});
test('dashboard reuses read-only API and reporting model without polling or write calls', () => {
  assert.match(dashboard,/\/api\/reliance-retail\/module-reports\/dashboard/);
  assert.match(dashboard,/selectRows\(source\?\.rows\|\|\[\], global, local\[id\]/);
  assert.doesNotMatch(dashboard,/setInterval\s*\(|method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
});
