import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildSurveyAssessmentWorkbook } from '../src/services/siteAssessmentWorkbookService.js';
import { createV2Survey } from '../src/services/siteAssessmentV2.js';

const templateBuffer = fs.readFileSync(path.resolve('../../reference/Survey Report Format (1).xlsx'));

function fullFixture() {
  const survey = createV2Survey({
    visit: {
      company: 'Synthetic Manufacturing Client',
      location: 'Synthetic Site',
      industry: 'Manufacturing',
      state: 'KL',
      city: 'Kochi',
      contacts: [{ name: 'Primary Contact', designation: 'Manager', phone: '9000000000', email: 'primary@example.test', isPrimary: true }, { name: 'Second Contact', email: 'second@example.test' }],
      serviceScope: ['Soft Services', 'Security Services'],
    },
    user: { name: 'Synthetic Surveyor', role: 'BD Executive', employee_code: 'QPMSTEST1', phone: '9000000001' },
  });
  survey.client_site.client_working_timings = '07:00-19:00';
  survey.client_site.client_working_days = '6 days';
  survey.client_site.qpms_service_timings = '08:00-17:00';
  survey.client_site.built_up_area = 125000;
  survey.client_site.occupants_staff = 420;
  survey.facility_requirements.external_waste_disposal_required = 'Yes';
  survey.facility_requirements.external_disposal_frequency = 'Daily';
  survey.facility_requirements.external_contractor_rate = 2500;
  survey.facility_requirements.water_bodies_present = 'Yes';
  survey.facility_requirements.water_body_details = 'Reflecting pool';
  survey.facility_requirements.facade_glass_present = 'Yes';
  survey.facility_requirements.facade_glass_area = 8000;
  survey.facility_requirements.facade_cleaning_frequency = 'Monthly';
  survey.facility_requirements.pest_control_required = 'Yes';
  survey.facility_requirements.pest_control_service_type = 'General pest control';
  survey.equipment_manpower.current_equipment = [1, 2, 3].map((number) => ({ description: `Current ${number}`, quantity: number }));
  survey.equipment_manpower.current_manpower = [1, 2, 3, 4].map((number) => ({ location: `Floor ${number}`, designation: 'Supervisor', shiftName: 'Day', headCount: number, monthlyTakeHomeSalary: 18000 }));
  survey.equipment_manpower.suggested_equipment = [1, 2, 3, 4, 5].map((number) => ({ description: `Suggested ${number}`, quantity: number }));
  survey.equipment_manpower.suggested_manpower = [
    { location: 'Ground', designation: 'Supervisor', shiftName: 'A Shift', startTime: '08:00', endTime: '17:00', headCount: 1, monthlyTakeHomeSalary: 22000 },
    { location: 'Ground', designation: 'Janitor', shiftName: 'A Shift', startTime: '08:00', endTime: '17:00', headCount: 4, monthlyTakeHomeSalary: 15000 },
    { location: 'Floor 1', designation: 'Janitor', shiftName: 'Night Shift', startTime: '20:00', endTime: '08:00', headCount: 2, monthlyTakeHomeSalary: 15500 },
  ];
  survey.commercial_inputs.minimum_wage_category = 'State';
  survey.commercial_inputs.zone = 'Z2';
  survey.commercial_inputs.salary_payment_terms = 'Monthly';
  survey.commercial_inputs.invoice_payment_terms = '30 days';
  survey.commercial_inputs.long_note = 'A deliberately long synthetic commercial note for wrapping validation.';
  return survey;
}

function build(survey) {
  return buildSurveyAssessmentWorkbook({
    assessment: { id: 'assessment-synthetic-001' },
    normalizedSurvey: survey,
    lead: { company: 'Synthetic Manufacturing Client' },
    contacts: survey.client_site?.contacts || [],
    profile: survey.client_site?.surveyor || {},
    workflow: {},
  }, { templateBuffer });
}

function roundTrip(workbook) {
  return XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true }), { cellStyles: true, cellFormula: true });
}

test('full export preserves workbook structure and maps the three sheets', () => {
  const workbook = roundTrip(build(fullFixture()));
  assert.deepEqual(workbook.SheetNames, ['Survey Report', 'MPD', 'Commercial Input']);
  assert.match(String(workbook.Sheets['Survey Report'].B2.v), /Survey Report/);
  assert.equal(workbook.Sheets['Survey Report'].C3.z, 'dd-mmm-yyyy');
  assert.equal(workbook.Sheets['Survey Report'].C4.v, 'Synthetic Manufacturing Client');
  assert.equal(workbook.Sheets['Survey Report'].D14.v, '07:00-19:00');
  assert.equal(workbook.Sheets['Survey Report'].B43.v, 'Current 1');
  assert.equal(workbook.Sheets['Survey Report'].B49.v, 'Suggested 1');
  assert.equal(workbook.Sheets['Commercial Input'].E4.v, 'Synthetic Manufacturing Client');
  assert.equal(workbook.Sheets.MPD.C5.v, 1);
});

test('MPD creates dynamic designation and shift columns with formulas', () => {
  const workbook = roundTrip(build(fullFixture()));
  const sheet = workbook.Sheets.MPD;
  const cells = Object.keys(sheet).filter((key) => !key.startsWith('!')).map((key) => sheet[key]?.v).filter(Boolean);
  assert.ok(cells.includes('Supervisor'));
  assert.ok(cells.includes('Janitor'));
  assert.ok(cells.includes('A Shift'));
  assert.ok(cells.includes('Night Shift'));
  const formulas = Object.values(sheet).filter((cell) => cell && typeof cell === 'object' && cell.f).map((cell) => cell.f);
  assert.ok(formulas.some((formula) => formula.includes('SUM(')));
});

test('minimal export removes template sample rows and handles empty MPD', () => {
  const survey = createV2Survey({ visit: { company: 'Minimal Client', location: 'Minimal Site', contacts: [{ name: 'Contact', isPrimary: true }] } });
  const workbook = roundTrip(build(survey));
  const values = Object.values(workbook.Sheets['Survey Report']).map((cell) => cell?.v).filter(Boolean);
  assert.ok(!values.includes('HK Supervisor'));
  assert.ok(!values.includes('Single Disk'));
  assert.equal(workbook.Sheets.MPD.B5.v, 'No proposed manpower deployment available');
});

test('large side-by-side blocks expand without retaining template answers', () => {
  const survey = fullFixture();
  survey.equipment_manpower.current_equipment = Array.from({ length: 6 }, (_, index) => ({ description: `Current expanded ${index + 1}`, quantity: index + 1 }));
  survey.equipment_manpower.current_manpower = Array.from({ length: 6 }, (_, index) => ({ designation: `Current role ${index + 1}`, headCount: index + 1, monthlyTakeHomeSalary: 12000 + index }));
  survey.equipment_manpower.suggested_equipment = Array.from({ length: 10 }, (_, index) => ({ description: `Suggested expanded ${index + 1}`, quantity: index + 1 }));
  survey.equipment_manpower.suggested_manpower = Array.from({ length: 10 }, (_, index) => ({ location: `Zone ${index + 1}`, designation: `Suggested role ${index + 1}`, shiftName: 'Day', headCount: index + 1, monthlyTakeHomeSalary: 14000 + index }));
  const workbook = roundTrip(build(survey));
  const sheet = workbook.Sheets['Survey Report'];
  const values = Object.values(sheet).map((cell) => cell?.v).filter(Boolean);
  assert.ok(values.includes('Current expanded 6'));
  assert.ok(values.includes('Suggested expanded 10'));
  assert.ok(!values.includes('Single Disk'));
  assert.ok(!values.includes('Vacuum Cleaner'));
  assert.ok(!values.includes('HK Supervisor'));
  assert.ok(!values.includes('HK Janitors'));
});

test('facility template Yes/No examples are replaced by actual applicability', () => {
  const survey = createV2Survey({ visit: { company: 'Conditional Client', contacts: [{ name: 'Contact', isPrimary: true }] } });
  survey.facility_requirements.water_bodies_present = 'No';
  survey.facility_requirements.facade_glass_present = 'No';
  const workbook = roundTrip(build(survey));
  const sheet = workbook.Sheets['Survey Report'];
  assert.equal(sheet.C25.v, 'No');
  assert.equal(sheet.D26.v, 'N/A');
  assert.equal(sheet.C27.v, 'No');
  assert.equal(sheet.D27.v, 'N/A');
  assert.equal(sheet.C39.v, '');
});

test('legacy normalized input exports without requiring a second exporter', () => {
  const survey = { schema_version: 1, siteSurveyDate: '2026-07-29', siteAddress: 'Legacy Site', siteType: 'Commercial', assessedBy: 'Legacy Surveyor', equipment: [], manpowerPlan: [], futureUnknownKey: { preserved: true } };
  const workbook = roundTrip(build(survey));
  assert.equal(workbook.Sheets['Survey Report'].C3.z, 'dd-mmm-yyyy');
  assert.equal(workbook.Sheets['Survey Report'].C5.v, 'Legacy Site');
  assert.doesNotThrow(() => workbook.Sheets['Commercial Input'].E4.v);
});
