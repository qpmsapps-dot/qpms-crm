import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeContacts, validateLeadForm } from '../src/components/preSales/leadFormModel.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('native Pre-Sales add and edit routes replace legacy CRM navigation', async () => {
  const [routes, dashboard, leads, details, formPage] = await Promise.all([
    read('src/routes/AppRoutes.jsx'), read('src/pages/preSales/PreSalesDashboard.jsx'),
    read('src/pages/preSales/PreSalesLeads.jsx'), read('src/pages/preSales/PreSalesLeadDetails.jsx'),
    read('src/pages/preSales/PreSalesLeadFormPage.jsx'),
  ]);
  assert.match(routes, /path: 'pre-sales\/leads\/new'/);
  assert.match(routes, /path: 'pre-sales\/leads\/:leadId\/edit'/);
  assert.match(dashboard, /navigate\('\/pre-sales\/leads\/new'\)/);
  assert.match(dashboard, /to="\/pre-sales\/leads\/new"/);
  assert.match(leads, /navigate\('\/pre-sales\/leads\/new'\)/);
  assert.match(details, /to={`\/pre-sales\/leads\/\$\{lead\.id\}\/edit`}/);
  assert.match(details, /to="\/pre-sales\/leads"/);
  assert.doesNotMatch([dashboard, leads, details, formPage].join('\n'), /\/crm\?lead=|\/crm\?workspace=pre-sales&action=add/);
  assert.match(formPage, /navigate\(editing \? `\/pre-sales\/leads\/\$\{leadId\}` : '\/pre-sales\/leads'\)/);
});

test('Leads page is a lightweight server-filtered list without duplicate KPI cards', async () => {
  const leads = await read('src/pages/preSales/PreSalesLeads.jsx');
  assert.match(leads, /Manage and follow active Pre-Sales opportunities\./);
  assert.match(leads, /Search leads\.\.\./);
  assert.match(leads, /Filters/);
  for (const filter of ['stage', 'owner', 'priority', 'date_from', 'date_to']) assert.match(leads, new RegExp(filter));
  for (const metric of ['Total Leads', 'Qualified Leads', 'Follow-ups Due', 'Invalid Leads']) assert.doesNotMatch(leads, new RegExp(metric));
  assert.match(leads, /getPreSalesLeads\(params\)/);
  assert.match(leads, /page_size: 20/);
});

test('native forms reuse authenticated backend create and update APIs without Supabase writes', async () => {
  const [page, api, sharedForm, model] = await Promise.all([
    read('src/pages/preSales/PreSalesLeadFormPage.jsx'), read('src/services/preSalesApi.js'),
    read('src/components/preSales/LeadForm.jsx'), read('src/components/preSales/leadFormModel.js'),
  ]);
  assert.match(page, /createPreSalesLead\(payload, idempotencyKey\.current\)/);
  assert.match(page, /updatePreSalesLead\(leadId, payload\)/);
  assert.match(api, /method: 'POST', url: '\/api\/pre-sales\/leads'/);
  assert.match(api, /method: 'PATCH', url: `\/api\/pre-sales\/leads\/\$\{encodeURIComponent\(leadId\)\}`/);
  assert.match(page, /possible_duplicate_lead/);
  assert.match(page, /duplicateOverrideReason/);
  assert.match(sharedForm, /LeadContactEditor/);
  assert.doesNotMatch(model.match(/export function leadFormToApiPayload[\s\S]*?\n}/)?.[0] || '', /assigned_bd|pre_sales_owner/);
  for (const field of ['name', 'designation', 'phone', 'email', 'isPrimary']) assert.match(model, new RegExp(field));
  assert.doesNotMatch([page, api, sharedForm, model].join('\n'), /supabase\.from|createClient/);
});

test('shared lead validation preserves contact requirements and rejects invalid values', () => {
  const form = {
    company: 'QPMS', industry: 'Commercial', location: 'Chennai', state: 'Tamil Nadu', city: 'Chennai', source: 'Referral', priority: 'High',
    contacts: [{ id: 'primary', name: '', designation: 'Manager', phone: 'bad', email: 'bad', isPrimary: true }],
  };
  const errors = validateLeadForm(form);
  assert.equal(errors['primary.name'], 'Contact name is required');
  assert.equal(errors['primary.phone'], 'Enter a valid phone number');
  assert.equal(errors['primary.email'], 'Enter a valid email');
  const contacts = normalizeContacts([{ name: 'One', phone: '9876543210', isPrimary: false }, { name: 'Two', phone: '9876543211', isPrimary: true }]);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[1].isPrimary, true);
});

test('CRM, Demo Viewer, Site Visit, sidebar, and read-only UAT protections remain intact', async () => {
  const [routes, crm, legacyRoute, sidebar, sites, uatService, preSalesRoutes] = await Promise.all([
    read('src/routes/AppRoutes.jsx'), read('src/pages/CRM.jsx'), read('src/routes/LegacyCrmRoute.jsx'),
    read('src/components/Sidebar.jsx'), read('src/pages/Sites.jsx'), read('backend/services/readOnlyUatMode.js'),
    read('backend/routes/preSalesRoutes.js'),
  ]);
  assert.match(routes, /path: 'crm', element: <LegacyCrmRoute/);
  assert.match(legacyRoute, /: <CRM \/>/);
  assert.match(crm, /from '\.\.\/components\/preSales\/LeadForm\.jsx'/);
  assert.match(crm, /sendLeadMomEmail/);
  assert.match(sidebar, /label: 'Lead Management', to: '\/crm'/);
  assert.match(sidebar, /label: 'Pre-Sales', to: '\/pre-sales', icon: Workflow, matchPrefix: true/);
  assert.match(sidebar, /NIMS Ticketing System/);
  assert.match(sites, /navigate\('\/crm'\)/);
  assert.match(uatService, /READ_ONLY_UAT_MODE/);
  assert.match(preSalesRoutes, /createRequireWritablePreSalesEnvironment/);
});
