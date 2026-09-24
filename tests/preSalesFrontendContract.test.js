import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pre-Sales dashboard, lead list, and lead detail routes are connected', async () => {
  const [routes, sidebar, dashboard, leads, details, queue] = await Promise.all([
    read('src/routes/AppRoutes.jsx'), read('src/components/Sidebar.jsx'),
    read('src/pages/preSales/PreSalesDashboard.jsx'), read('src/pages/preSales/PreSalesLeads.jsx'),
    read('src/pages/preSales/PreSalesLeadDetails.jsx'), read('src/pages/preSales/PreSalesWorkQueue.jsx'),
  ]);
  assert.match(routes, /path: 'pre-sales'/);
  assert.match(routes, /path: 'pre-sales\/leads'/);
  assert.match(routes, /path: 'pre-sales\/leads\/:leadId'/);
  assert.match(dashboard, /View All Leads/);
  assert.match(dashboard, /getPreSalesDashboard/);
  assert.match(leads, /page_size: 20/);
  assert.match(leads, /getPreSalesLeads\(params\)/);
  assert.match(details, /Call History/);
  assert.match(details, /AddCallUpdateForm/);
  assert.match(sidebar, /const preSalesNavItem = \{ label: 'Pre-Sales', to: '\/pre-sales', icon: Workflow, matchPrefix: true \}/);
  assert.doesNotMatch(sidebar, /label: '(?:Leads|Follow-ups|Meetings|Handover to BD)', to: '\/pre-sales/);
  assert.match(sidebar, /location\.pathname\.startsWith\(`\$\{item\.to\}\//);
  assert.match(dashboard, /filter=today/);
  assert.match(dashboard, /filter=callbacks/);
  assert.match(dashboard, /filter=overdue/);
  assert.match(queue, /useSearchParams/);
  assert.match(queue, /requestedFilter/);
});

test('Pre-Sales owns sidebar navigation and uses native lead intake without a duplicate global item', async () => {
  const [sidebar, dashboard, leads, routes, legacyRoute] = await Promise.all([
    read('src/components/Sidebar.jsx'), read('src/pages/preSales/PreSalesDashboard.jsx'),
    read('src/pages/preSales/PreSalesLeads.jsx'), read('src/routes/AppRoutes.jsx'),
    read('src/routes/LegacyCrmRoute.jsx'),
  ]);
  const nonDemoSidebar = sidebar.slice(0, sidebar.indexOf('const tenderDemoNavGroups'));
  assert.doesNotMatch(nonDemoSidebar, /label: 'Lead Management'/);
  assert.match(dashboard, /\/pre-sales\/leads\/new/);
  assert.match(leads, /\/pre-sales\/leads\/new/);
  assert.match(routes, /path: 'pre-sales\/leads\/new'/);
  assert.match(legacyRoute, /workspace.*pre-sales[\s\S]*action.*add[\s\S]*\/pre-sales\/leads\/new/);
});

test('feedback form uses canonical outcomes, renders conditional scheduling, and submits through the API', async () => {
  const [form, details, api, constants] = await Promise.all([
    read('src/components/preSales/AddCallUpdateForm.jsx'),
    read('src/pages/preSales/PreSalesLeadDetails.jsx'),
    read('src/services/preSalesApi.js'),
    read('shared/preSalesConstants.js'),
  ]);
  for (const value of ['RNR', 'CALL_BACK', 'FUTURE_FOLLOWUP', 'NO_REQUIREMENT', 'INVALID_LEAD', 'INTERESTED']) assert.match(constants, new RegExp(`${value}:`));
  assert.match(form, /FEEDBACK_REQUIRING_FOLLOWUP/);
  assert.match(form, /meeting_required/);
  assert.match(form, /followup_at/);
  assert.match(details, /addCallUpdate\(leadId, payload\)/);
  assert.match(api, /\/api\/pre-sales\/leads\/\$\{encodeURIComponent\(leadId\)\}\/call-update/);
});

test('Pre-Sales frontend uses authenticated APIs and contains no direct Supabase access or fake KPI values', async () => {
  const files = await Promise.all([
    read('src/pages/preSales/PreSalesDashboard.jsx'), read('src/pages/preSales/PreSalesLeads.jsx'),
    read('src/pages/preSales/PreSalesLeadDetails.jsx'), read('src/pages/preSales/PreSalesWorkQueue.jsx'),
  ]);
  const source = files.join('\n');
  assert.doesNotMatch(source, /supabase\.from|createClient/);
  assert.doesNotMatch(source, /124 leads|42 qualified|\+20%|\+50%/i);
  assert.match(source, /LoadingState/);
  assert.match(source, /EmptyState/);
  assert.match(source, /ErrorState/);
});

test('Pre-Sales edit controls use normalized frontend permissions in addition to backend guards', async () => {
  const [form, details, roles, userForm] = await Promise.all([
    read('src/components/preSales/AddCallUpdateForm.jsx'),
    read('src/pages/preSales/PreSalesLeadDetails.jsx'),
    read('src/utils/authRoles.js'),
    read('src/components/user-management/UserFormDrawer.jsx'),
  ]);
  assert.match(form, /canEditPreSalesLead\(user\)/);
  assert.match(details, /canAssignLead\(user\)/);
  assert.match(roles, /export function canEditPreSalesLead/);
  assert.match(roles, /normalizeAppRole\(user\?\.rawRole \|\| user\?\.role\) === 'DemoViewer'/);
  assert.match(userForm, /'Pre-Sales Manager'/);
  assert.match(userForm, /'Pre-Sales Executive'/);
});
