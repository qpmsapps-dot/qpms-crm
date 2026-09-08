import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  isProfileInOperationsCommandCenterScope,
  operationsCommandCenterAllowedEmployeeCodes,
} from '../services/foOperationalAccessService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const serverSource = fs.readFileSync(path.join(repoRoot, 'backend', 'server.js'), 'utf8');
const foActivitiesSource = fs.readFileSync(path.join(repoRoot, 'src', 'pages', 'FOActivities.jsx'), 'utf8');

const active = (overrides) => ({
  id: overrides.employee_code || overrides.role,
  status: 'Active',
  is_active: true,
  web_access_enabled: true,
  ...overrides,
});

function endpointSource() {
  const routeIndex = serverSource.indexOf("'/api/fo/operations/employee-drilldown'");
  assert.notEqual(routeIndex, -1, 'employee drill-down route should exist');
  return serverSource.slice(routeIndex, routeIndex + 4200);
}

describe('FO employee drill-down endpoint hardening', () => {
  test('employee drill-down endpoint is read-only and JWT protected', () => {
    const source = endpointSource();
    assert.match(source, /requireSupabaseJwt/);
    assert.match(source, /resolveFoDrilldownTarget/);
    assert.doesNotMatch(source, /\.insert\(/);
    assert.doesNotMatch(source, /\.update\(/);
    assert.doesNotMatch(source, /\.delete\(/);
    assert.doesNotMatch(source, /\.upsert\(/);
  });

  test('target employee authorization uses the canonical Operations Command Center scope resolver', () => {
    const resolverIndex = serverSource.indexOf('async function resolveFoDrilldownTarget');
    const nextFunctionIndex = serverSource.indexOf('function normalizeMobileLeadRole');
    assert.notEqual(resolverIndex, -1);
    assert.notEqual(nextFunctionIndex, -1);
    const source = serverSource.slice(resolverIndex, nextFunctionIndex);
    assert.match(source, /loadFieldOperationsConfiguredAccess/);
    assert.match(source, /attachFoConfiguredAccess/);
    assert.match(source, /isProfileInOperationsCommandCenterScope\(actor, target, profiles/);
    assert.match(source, /throw userManagementHttpError\(403/);
  });

  test('date range must be bounded to explicit YYYY-MM-DD values', () => {
    const boundsIndex = serverSource.indexOf('function foDrilldownDateBounds');
    const csvIndex = serverSource.indexOf('function foDrilldownCsvValues');
    assert.notEqual(boundsIndex, -1);
    assert.notEqual(csvIndex, -1);
    const source = serverSource.slice(boundsIndex, csvIndex);
    assert.match(source, /date_from and date_to must use YYYY-MM-DD/);
    assert.match(source, /date_from cannot be after date_to/);
    assert.match(source, /T00:00:00\+05:30/);
    assert.match(source, /T23:59:59\.999\+05:30/);
  });

  test('location log lookup mirrors legacy fallback columns without returning unbounded history', () => {
    const source = serverSource.slice(
      serverSource.indexOf('async function fetchFoDrilldownLocationLogs'),
      serverSource.indexOf('async function fetchFoDrilldownActivityRows'),
    );
    assert.match(source, /attendance_id/);
    assert.match(source, /\['fo_user_id', 'employee_code', 'username'\]/);
    assert.match(source, /\['captured_at', 'logged_at', 'created_at'\]/);
    assert.match(source, /fromIso: period\.from_iso/);
    assert.match(source, /toIso: period\.to_iso/);
    assert.match(source, /limit: 10000/);
  });

  test('activity lookup mirrors legacy employee/date and site-visit context filters', () => {
    const source = serverSource.slice(
      serverSource.indexOf('async function fetchFoDrilldownActivityRows'),
      serverSource.indexOf('async function resolveFoDrilldownTarget'),
    );
    assert.match(source, /fo_activity_submissions|table/);
    assert.match(source, /\['fo_user_id', 'employee_code'\]/);
    assert.match(source, /site_visit_id/);
    assert.match(source, /fromIso: period\.from_iso/);
    assert.match(source, /toIso: period\.to_iso/);
  });

  test('activity upload URLs are signed only after backend target authorization', () => {
    const route = endpointSource();
    const signer = serverSource.slice(
      serverSource.indexOf('async function attachAuthorizedFoUploadUrl'),
      serverSource.indexOf('async function resolveFoDrilldownTarget'),
    );
    assert.match(route, /resolveFoDrilldownTarget/);
    assert.match(route, /validateFoDrilldownContext/);
    assert.match(route, /attachAuthorizedFoUploadUrl/);
    assert.match(signer, /createSignedUrl/);
    assert.match(foActivitiesSource, /upload\?\.authorized_signed_url/);
  });

  test('frontend uses the authorized backend for live GPS, activity, and upload drill-down', () => {
    const routeEffect = foActivitiesSource.slice(
      foActivitiesSource.indexOf('async function loadSelectedRouteLogs'),
      foActivitiesSource.indexOf('async function loadSelectedActivityUploads'),
    );
    const activityEffect = foActivitiesSource.slice(
      foActivitiesSource.indexOf('async function loadSelectedActivityUploads'),
      foActivitiesSource.indexOf('async function loadSupportContext'),
    );
    assert.match(foActivitiesSource, /api\/fo\/operations\/employee-drilldown\?/);
    assert.match(routeEffect, /loadFoDrilldown/);
    assert.match(activityEffect, /loadFoDrilldown/);
    assert.doesNotMatch(routeEffect, /supabase\s*\.from\("fo_location_logs"\)/);
    assert.doesNotMatch(activityEffect, /supabase\s*\.from\("fo_activity_submissions"\)/);
    assert.doesNotMatch(activityEffect, /supabase\s*\.from\("fo_activity_uploads"\)/);
  });

  test('supplied attendance and site visit IDs are validated against target and date range', () => {
    const start = serverSource.indexOf('async function validateFoDrilldownContext');
    const end = serverSource.indexOf('function normalizeMobileLeadRole', start);
    const source = serverSource.slice(start, end);
    assert.match(source, /foDrilldownRowBelongsToTarget\(attendance, target\)/);
    assert.match(source, /attendanceDate < period\.date_from/);
    assert.match(source, /foDrilldownRowBelongsToTarget\(visit, target\)/);
    assert.match(source, /visitTime < new Date\(period\.from_iso\)/);
    assert.match(source, /throw userManagementHttpError\(403/);
  });

  test('consolidated PDF attaches configured FO access before report generation', () => {
    const start = serverSource.indexOf("'/api/fo/reports/consolidated-travel-claims/pdf'");
    const end = serverSource.indexOf("app.get('/api/fo/operations/dashboard'", start);
    const source = serverSource.slice(start, end);
    assert.match(source, /loadFieldOperationsConfiguredAccess\(client, \[request\.profile\?\.id\]\)/);
    assert.match(source, /attachFoConfiguredAccess\(request\.profile \|\| \{\}, actorConfig\)/);
    assert.match(source, /buildConsolidatedTravelClaimPdf\(\s*client,\s*actor,/);
  });

  test('Arun target scope remains Reliance Retail across five states only', () => {
    const actor = active({ employee_code: 'QPMSTNC16972', role: 'GM', state: 'TN', business: 'Reliance Retail' });
    const profiles = [
      active({ employee_code: 'AP_RR', role: 'FO', state: 'AP', business: 'Reliance Retail' }),
      active({ employee_code: 'TN_RR', role: 'FO', state: 'TN', business: 'Retail' }),
      active({ employee_code: 'TN_ST', role: 'FO', state: 'TN', business: 'Standalone' }),
      active({ employee_code: 'NIMS', role: 'FO', state: 'TG', business: 'Hospitals', metadata: { client_name: 'NIMS Hyderabad' } }),
    ];
    const allowed = operationsCommandCenterAllowedEmployeeCodes(actor, profiles, []);
    assert.equal(allowed.has('AP_RR'), true);
    assert.equal(allowed.has('TN_RR'), true);
    assert.equal(allowed.has('TN_ST'), false);
    assert.equal(allowed.has('NIMS'), false);
  });

  test('Operations Manager cannot use the Suresh Command Center drill-down override', () => {
    const actor = active({ employee_code: 'QPMSTN3082', role: 'Operations Manager', state: 'TN', business: 'Standalone' });
    const profiles = [
      active({ employee_code: 'TN_ST', role: 'FO', state: 'TN', business: 'Standalone' }),
      active({ employee_code: 'TN_RR', role: 'FO', state: 'TN', business: 'Reliance Retail' }),
      active({ employee_code: 'KA_ST', role: 'FO', state: 'KA', business: 'Standalone' }),
    ];
    assert.equal(isProfileInOperationsCommandCenterScope(actor, { employee_code: 'TN_ST' }, profiles, []), false);
    assert.equal(isProfileInOperationsCommandCenterScope(actor, { employee_code: 'TN_RR' }, profiles, []), false);
    assert.equal(isProfileInOperationsCommandCenterScope(actor, { employee_code: 'KA_ST' }, profiles, []), false);
  });

  test('configured KA Reliance-only scope excludes Standalone from every shared target check', () => {
    const actor = active({
      employee_code: 'QPMSKL0318',
      role: 'Branch Head',
      state: 'KA',
      business: 'Reliance Retail',
      fo_access_config: {
        active: true,
        role: 'branch_head',
        states: ['KA'],
        business_groups: ['reliance_retail'],
        businesses: ['Reliance Retail', 'Retail'],
        source: 'access_user_assignments',
      },
    });
    const profiles = [
      active({ employee_code: 'KA_RR', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
      active({ employee_code: 'KA_ST', role: 'FO', state: 'KA', business: 'Standalone' }),
    ];
    const hierarchy = [
      { employee_code: 'KA_RR', manager_employee_code: 'QPMSKL0318', is_active: true },
      { employee_code: 'KA_ST', manager_employee_code: 'QPMSKL0318', is_active: true },
    ];
    assert.equal(isProfileInOperationsCommandCenterScope(actor, profiles[0], profiles, hierarchy), true);
    assert.equal(isProfileInOperationsCommandCenterScope(actor, profiles[1], profiles, hierarchy), false);
  });
});
