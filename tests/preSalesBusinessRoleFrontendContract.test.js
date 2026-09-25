import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical and legacy Pre-Sales roles normalize to one minimal module capability', async () => {
  const [roles, sidebar, drawer] = await Promise.all([
    read('src/utils/authRoles.js'), read('src/components/Sidebar.jsx'), read('src/components/user-management/UserFormDrawer.jsx'),
  ]);
  assert.match(roles, /PRESALES: 'Pre-Sales'/);
  assert.match(roles, /PRESALESEXECUTIVE: 'Pre-Sales'/);
  assert.match(roles, /PRESALESMANAGER: 'Pre-Sales'/);
  assert.match(sidebar, /const preSalesOnlyNavGroups/);
  assert.match(sidebar, /normalizeAppRole\(user\?\.rawRole \|\| user\?\.role\) === 'PreSales'/);
  assert.match(drawer, /'Pre-Sales', 'Admin'/);
  assert.match(drawer, /legacyPreSalesRoles/);
});

test('lead details obey server permissions and expose sanitized Opportunity Progress', async () => {
  const [details, progress, api] = await Promise.all([
    read('src/pages/preSales/PreSalesLeadDetails.jsx'), read('src/components/preSales/OpportunityProgress.jsx'), read('src/services/preSalesApi.js'),
  ]);
  assert.match(details, /permissions\.access_mode === 'read_only'/);
  assert.match(details, /permissions\.can_edit_pre_sales/);
  assert.match(details, /permissions\.can_add_call_update/);
  assert.match(details, /Opportunity Progress/);
  assert.match(api, /opportunity-progress/);
  for (const label of ['Current Stage', 'Responsible Department', 'Proposal Status', 'Final Outcome']) assert.match(progress, new RegExp(label));
  assert.doesNotMatch(progress, /proposal_value|margin_percent|proposal_payload|commercial_costing|client_kyc/);
});

test('dashboard exposes scoped My Leads and proposal progress metrics', async () => {
  const dashboard = await read('src/pages/preSales/PreSalesDashboard.jsx');
  for (const key of ['my_leads', 'proposal_in_progress', 'proposal_success']) assert.match(dashboard, new RegExp(key));
});
