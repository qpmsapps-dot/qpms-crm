import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const outputDir = 'D:/QPMS_CRM/.phase4-test-output';
const authKey = 'qpms-crm-auth-user';
const visitsKey = 'qpms-crm-workflow-site-visits';
const leadsKey = 'qpms-crm-workflow-leads';

function assessmentFixture({ legacy = false } = {}) {
  return {
    schema_version: legacy ? 1 : 2,
    client_site: {
      survey_date: '2026-07-30',
      client_name: 'Synthetic Browser Client',
      client_legal_name: 'Synthetic Browser Client Private Limited',
      site_address: '100 Synthetic Avenue',
      site_location: 'Synthetic Campus',
      managed_from: 'Synthetic City',
      state: 'Synthetic State',
      city: 'Synthetic City',
      zone: 'Z1',
      industry: 'Manufacturing',
      contacts: [
        { name: 'Synthetic Primary', designation: 'Manager', phone: '9000000000', email: 'primary@example.test', isPrimary: true },
        { name: 'Synthetic Secondary', designation: 'Admin', phone: '9000000001', email: 'secondary@example.test', isPrimary: false },
      ],
      surveyor: { name: 'Synthetic Surveyor', designation: 'BD Executive', phone: '9000000002', employee_code: 'SYNTH001' },
      client_working_timings: '08:00-17:00',
      client_working_days: '6 days',
      qpms_service_timings: '08:00-17:00',
      built_up_area: 125000,
      occupants_staff: 420,
      floating_footfall: 900,
    },
    facility_requirements: {
      service_scope: ['Soft Services', 'Security Services', 'Other Services'],
      other_services_description: 'Synthetic additional scope',
      waste_segregation_required: 'Yes',
      external_waste_disposal_required: 'Yes',
      external_disposal_frequency: 'Daily',
      external_contractor_rate: 2500,
      pantry_service_required: 'Yes',
      number_of_pantries: 3,
      total_pantry_area: 750,
      water_bodies_present: 'Yes',
      water_body_details: 'Synthetic pool',
      water_body_maintenance: 'Yes',
      facade_glass_present: 'Yes',
      facade_glass_area: 8000,
      facade_cleaning_frequency: 'Monthly',
      boom_lift_available: 'Yes',
      pest_control_required: 'Yes',
      pest_control_service_type: 'General',
      pest_control_frequency: 'Monthly',
      specialized_cleaning_required: 'Yes',
      specialized_cleaning_services: 'Carpet',
      specialized_cleaning_frequency: 'Quarterly',
      neighbouring_manpower_availability: 'Yes',
      staff_transportation_required: 'Yes',
      estimated_transport_cost: 1200,
      retain_existing_staff: 'Yes',
      existing_salary_structure: 'Synthetic salary details',
      special_ppe_required: 'Yes',
      ppe_details: 'Synthetic PPE',
      medical_verification_required: 'Yes',
      police_verification_required: 'No',
      wage_category: 'State',
    },
    equipment_manpower: {
      current_equipment: [{ description: 'Current synthetic machine', quantity: 2 }],
      suggested_equipment: [{ description: 'Suggested synthetic machine', quantity: 3 }],
      current_manpower: [{ location: 'Ground', designation: 'Supervisor', shiftName: 'Day', startTime: '08:00', endTime: '17:00', headCount: 1, monthlyTakeHomeSalary: 18000 }],
      suggested_manpower: [
        { location: 'Ground', designation: 'Janitor', shiftName: 'Day', startTime: '08:00', endTime: '17:00', headCount: 4, monthlyTakeHomeSalary: 15000 },
        { location: 'Ground', designation: 'Janitor', shiftName: 'Day', startTime: '08:00', endTime: '17:00', headCount: 2, monthlyTakeHomeSalary: 15000 },
        { location: 'Floor 1', designation: 'Supervisor', shiftName: 'Night', startTime: '20:00', endTime: '08:00', headCount: 1, monthlyTakeHomeSalary: 22000 },
      ],
    },
    commercial_inputs: {
      minimum_wage_category: 'State',
      zone: 'Z1',
      salary_payment_terms: 'Monthly synthetic payment terms',
      invoice_payment_terms: '30 synthetic days',
      attendance_cycle_start: '26',
      attendance_cycle_end: '25',
      other_commercial_remarks: 'Synthetic long commercial remarks for browser QA.',
    },
    legacy: legacy ? { hse: { synthetic: true }, risk: { level: 'Low' }, kyc: { verified: false }, penalty: { note: 'Synthetic' }, unknownLegacyKey: { retained: true } } : {},
  };
}

function visitFixture(options = {}) {
  const survey = assessmentFixture(options);
  return {
    id: options.legacy ? 'synthetic-legacy-visit' : 'synthetic-browser-visit',
    assessmentId: options.legacy ? 'synthetic-legacy-assessment' : 'synthetic-browser-assessment',
    leadId: 'synthetic-lead',
    company: 'Synthetic Browser Client',
    industry: 'Manufacturing',
    location: 'Synthetic Campus',
    state: 'Synthetic State',
    city: 'Synthetic City',
    contacts: survey.client_site.contacts,
    assigned_bd_executive: 'Synthetic Surveyor',
    assigned_bd_email: 'surveyor@example.test',
    created_by_name: 'Synthetic Surveyor',
    currentStage: 'Pre-Operational Assessment',
    status: 'Scheduled',
    survey,
  };
}

async function seed(page, { legacy = false } = {}) {
  await page.addInitScript(({ auth, visits, leads }) => {
    localStorage.setItem('qpms-crm-auth-user', JSON.stringify(auth));
    localStorage.setItem('qpms-crm-workflow-site-visits', JSON.stringify(visits));
    localStorage.setItem('qpms-crm-workflow-leads', JSON.stringify(leads));
  }, {
    auth: { id: 'synthetic-bd', profileId: 'synthetic-bd-profile', name: 'Synthetic Surveyor', full_name: 'Synthetic Surveyor', email: 'surveyor@example.test', role: 'BD Executive', status: 'Active', isActive: true, webAccessEnabled: true, authProvider: 'demo-fixture', is_demo: true, isDemoReadOnly: true, read_only: false },
    visits: [visitFixture({ legacy })],
    leads: [{ id: 'synthetic-lead', company: 'Synthetic Browser Client', industry: 'Manufacturing', location: 'Synthetic Campus', state: 'Synthetic State', city: 'Synthetic City', contacts: assessmentFixture().client_site.contacts }],
  });
  await page.goto(`/site-visit/${legacy ? 'synthetic-legacy-visit' : 'synthetic-browser-visit'}`);
  await expect(page.getByText('Client and site details')).toBeVisible();
}

test.describe('four-section site assessment', () => {
  test('navigation, prefill, conditional fields, and responsive layout', async ({ page }) => {
    await seed(page);
    await expect(page.getByLabel('Client Name')).toHaveValue('Synthetic Browser Client');
    await expect(page.getByLabel('Industry / Nature of Business')).toHaveValue('Manufacturing');
    await expect(page.getByLabel('Survey Done By')).toHaveValue('Synthetic Surveyor');
    await expect(page.locator('label').filter({ hasText: /^Name$/ }).locator('input').nth(1)).toHaveValue('Synthetic Secondary');

    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Client & Site', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Facility and service requirements')).toBeVisible();
    await page.getByLabel('External Waste Disposal').selectOption('No');
    await expect(page.getByLabel('External Disposal Frequency')).toHaveCount(0);
    await page.getByLabel('External Waste Disposal').selectOption('Yes');
    await expect(page.getByLabel('External Disposal Frequency')).toBeVisible();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByText('Client and site details')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(viewportOverflow).toBe(true);
    await page.screenshot({ path: path.join(outputDir, 'client-site-mobile.png') });
  });

  test('dynamic rows, MPD grouping, draft, autosave, and review submission', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Current Equipment', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add Row' }).first().click();
    await expect(page.getByText('Copy current to suggested')).toHaveCount(2);
    await expect(page.getByText('MPD preview')).toBeVisible();
    await expect(page.getByText('Janitor')).toHaveCount(1);
    await expect(page.getByText('Ground')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await expect(page.getByRole('status').getByText('Saved successfully')).toBeVisible();

    await page.getByLabel('Description').first().fill('Autosave synthetic value');
    await page.clock.install();
    await page.clock.fastForward(30_000);
    await expect(page.getByText(/Saved just now|Saved successfully/)).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Commercial inputs', exact: true })).toBeVisible();
    await expect(page.getByText('Read-only survey summary')).toBeVisible();
    await expect(page.getByText('Review summary')).toBeVisible();
    await page.getByRole('button', { name: 'Submit for Reviews' }).click();
    await expect(page.getByText('Submitted for Review', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(outputDir, 'commercial-review.png'), fullPage: true });
  });

  test('viewport and keyboard accessibility smoke checks', async ({ page }) => {
    await seed(page);
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [360, 800]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      const fitsViewport = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(fitsViewport).toBe(true);
      await page.screenshot({ path: path.join(outputDir, `client-site-${width}x${height}.png`) });
    }
    await page.getByLabel('Client Name').focus();
    await expect(page.getByLabel('Client Name')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Next' })).toHaveAccessibleName('Next');
  });

  test('workbook export downloads and is inspectable', async ({ page }) => {
    await seed(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Survey Workbook' }).click();
    const download = await downloadPromise;
    const target = path.join(outputDir, await download.suggestedFilename());
    await download.saveAs(target);
    const workbook = XLSX.read(fs.readFileSync(target), { type: 'buffer', cellStyles: true, cellFormula: true });
    expect(workbook.SheetNames).toEqual(['Survey Report', 'MPD', 'Commercial Input']);
    expect(JSON.stringify(workbook.Sheets['Survey Report'])).not.toContain('HK Supervisor');
    expect(JSON.stringify(workbook.Sheets.MPD)).not.toContain('Ground Floor');
    await expect(page.getByText('Survey workbook downloaded')).toBeVisible();
  });

  test('legacy version-one record remains visible and exportable', async ({ page }) => {
    await seed(page, { legacy: true });
    await expect(page.getByText('Client and site details')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Survey Workbook' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Start').first().fill('08:00');
    await page.getByLabel('End').first().fill('17:00');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Legacy Assessment Details')).toBeVisible();
    await page.screenshot({ path: path.join(outputDir, 'legacy-assessment.png'), fullPage: true });
  });
});
