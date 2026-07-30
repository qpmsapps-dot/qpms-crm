import assert from 'node:assert/strict';
import test from 'node:test';
import { dbAssessmentToSurvey, surveyToDbAssessment } from '../src/services/siteAssessmentMapper.js';
import { validateAssessmentSection } from '../src/components/site-assessment/assessmentValidation.js';
import {
  SERVICE_SCOPE_OPTIONS,
  SURVEY_SCHEMA_VERSION_V1,
  SURVEY_SCHEMA_VERSION_V2,
  createV2Survey,
  emptyEquipment,
  emptyManpower,
  orderedScope,
} from '../src/services/siteAssessmentV2.js';

const visit = {
  id: '11111111-1111-4111-8111-111111111111',
  leadId: '22222222-2222-4222-8222-222222222222',
  company: 'Synthetic Client',
  location: 'Synthetic Site',
  industry: 'Commercial',
  state: 'KL',
  city: 'Kochi',
  contacts: [{ name: 'Primary Contact', phone: '9000000000', email: 'contact@example.test', isPrimary: true }],
};

test('new assessment defaults to schema version 2 with lead and surveyor prefill', () => {
  const survey = createV2Survey({ visit, user: { name: 'Surveyor', role: 'BD Executive', employee_code: 'QPMSTEST1' } });
  assert.equal(survey.schema_version, SURVEY_SCHEMA_VERSION_V2);
  assert.equal(survey.client_site.client_name, 'Synthetic Client');
  assert.equal(survey.client_site.industry, 'Commercial');
  assert.equal(survey.client_site.surveyor.name, 'Surveyor');
  assert.equal(survey.client_site.contacts[0].email, 'contact@example.test');
});

test('version 2 envelope round-trips without losing nested sections', () => {
  const survey = createV2Survey({ visit });
  survey.client_site.client_working_days = '6 days';
  survey.facility_requirements.service_scope = ['Soft Services', 'Security Services'];
  survey.equipment_manpower.suggested_equipment = [{ ...emptyEquipment(), description: 'Scrubber', quantity: 2 }];
  survey.equipment_manpower.suggested_manpower = [{ ...emptyManpower(), designation: 'Supervisor', headCount: 1, count: 1 }];
  survey.commercial_inputs.payment_terms = '30 days';
  const row = surveyToDbAssessment(survey, visit);
  const restored = dbAssessmentToSurvey(row);
  assert.equal(row.schema_version, SURVEY_SCHEMA_VERSION_V2);
  assert.equal(row.metadata.survey_schema_version, SURVEY_SCHEMA_VERSION_V2);
  assert.equal(restored.schema_version, SURVEY_SCHEMA_VERSION_V2);
  assert.equal(restored.client_site.client_working_days, '6 days');
  assert.deepEqual(restored.facility_requirements.service_scope, ['Soft Services', 'Security Services']);
  assert.equal(restored.equipment_manpower.suggested_equipment[0].description, 'Scrubber');
  assert.equal(restored.commercial_inputs.payment_terms, '30 days');
});

test('version 1 records remain readable and unknown keys remain preserved', () => {
  const row = surveyToDbAssessment({ siteAddress: 'Legacy address', futureField: { keep: true } }, visit);
  assert.equal(row.schema_version, SURVEY_SCHEMA_VERSION_V1);
  assert.equal(dbAssessmentToSurvey(row).futureField.keep, true);
  assert.equal(dbAssessmentToSurvey(row).siteAddress, 'Legacy address');
});

test('structured section data overrides a stale version 2 snapshot', () => {
  const restored = dbAssessmentToSurvey({
    schema_version: 2,
    metadata: { survey_state_v2: { schema_version: 2, client_site: { client_working_days: '5 days' } } },
    basic_site_information: {},
    assessment_sections: [{ section_key: 'client_site', version: 2, section_data: { client_working_days: '6 days' } }],
  });
  assert.equal(restored.client_site.client_working_days, '6 days');
  assert.equal(restored.client_working_days, '6 days');
});

test('approved service scope order is stable', () => {
  assert.deepEqual(orderedScope(['Security Services', 'Soft Services', 'Soft Services']), ['Soft Services', 'Security Services']);
  assert.equal(SERVICE_SCOPE_OPTIONS.length, 7);
});

test('hidden conditional fields do not block facility validation', () => {
  const errors = validateAssessmentSection('Facility & Service Requirements', {
    facility_requirements: { external_waste_disposal_required: 'No', water_bodies_present: 'No' },
  });
  assert.deepEqual(errors, []);
});

test('equipment and manpower validation rejects negative values and zero-duration shifts', () => {
  const errors = validateAssessmentSection('Equipment, Manpower & MPD', {
    equipment_manpower: {
      suggested_equipment: [{ quantity: -1 }],
      suggested_manpower: [{ designation: 'Supervisor', headCount: 1, startTime: '09:00', endTime: '09:00', monthlyTakeHomeSalary: 1000 }],
    },
  }, { isSubmission: true });
  assert.ok(errors.some((message) => message.includes('negative')));
  assert.ok(errors.some((message) => message.includes('end time')));
});

test('overnight manpower shifts are valid', () => {
  const errors = validateAssessmentSection('Equipment, Manpower & MPD', {
    equipment_manpower: {
      suggested_manpower: [{ designation: 'Supervisor', headCount: 1, startTime: '18:00', endTime: '09:00', monthlyTakeHomeSalary: 1000 }],
    },
  }, { isSubmission: true });
  assert.deepEqual(errors, []);
});
