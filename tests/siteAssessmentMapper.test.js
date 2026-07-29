import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dbAssessmentToSurvey,
  surveyToDbAssessment,
} from '../src/services/siteAssessmentMapper.js';

const visit = {
  id: '11111111-1111-4111-8111-111111111111',
  leadId: '22222222-2222-4222-8222-222222222222',
  assigned_bd_email: 'bd@example.test',
};

function completeSurvey() {
  return {
    siteAddress: 'Test address',
    siteType: 'Commercial',
    operatingHours: '09:00-18:00',
    clientOccupancy: '120',
    buildingAge: '8 years',
    takeoverComplexity: 'High',
    siteSurveyDate: '2026-07-29',
    assessedBy: 'Test Surveyor',
    siteContactPerson: 'Test Contact',
    contactNumber: '9000000000',
    contactEmail: 'contact@example.test',
    totalSiteArea: '42000',
    contractPeriod: '12 months',
    marginAgreed: '10',
    marginType: 'Percentage',
    paymentTerms: '30 days',
    groupOrSisterConcernBusiness: 'Yes',
    is247Operation: 'No',
    ifmScope: { housekeeping: { selected: true } },
    hardServices: { mechanical: { HVAC: { quantity: 2 } } },
    softServices: { housekeeping: { Lobby: { frequency: 'Daily' } } },
    landscaping: { Gardens: { selected: true } },
    hseCompliance: [{ item: 'PPE', status: 'Compliant' }],
    manpowerPlan: [{ id: 'm1', designation: 'Supervisor', count: 2 }],
    minimumWagesType: 'State',
    applicableZone: 'Z2',
    wageComputationNotes: 'Fixture notes',
    relieverCostRequired: 'Yes',
    budgetedTakeHomeFeasibility: 'Feasible',
    localWorkforceAvailability: 'Available',
    transportationImpact: 'Low',
    bonusPaymentType: 'Statutory',
    leaveWithWagesDays: 18,
    nfhApplicable: 'Yes',
    travelAccommodationProvided: 'No',
    allowances: { transport: { applicable: 'Yes', monthlyCost: 1200 } },
    equipment: [{ id: 'e1', name: 'Vacuum', quantity: 2 }],
    chemicals: [{ id: 'c1', name: 'Cleaner', quantity: 3 }],
    tools: [{ id: 't1', name: 'Mop', quantity: 4 }],
    ppeUniforms: [{ id: 'p1', name: 'Gloves', quantity: 5 }],
    machinery: [{ id: 'x1', name: 'Scrubber', quantity: 1 }],
    consumables: 'Monthly',
    rentalMachinery: 'Required',
    nonBillableExpenses: 'None',
    uniformsShoesAccessories: 'Two sets',
    clientKyc: { gstRegistration: 'Available', billingAddress: 'Billing address' },
    risks: [{ name: 'Operational Risk', level: 'Medium' }],
    clientCreditRating: 'A',
    marketAssessment: 'Stable',
    goodPaymaster: 'Yes',
    existingVendorChangeReason: 'Service quality',
    mitigationPlan: 'Monthly review',
    riskRemarks: 'Fixture risk',
    penaltyClauses: [{ id: 'penalty-1', penaltyClauseAvailable: 'No' }],
    commercial: {
      billingComponents: [{ id: 'b1', name: 'Manpower', amount: 500000 }],
      expenseComponents: [{ id: 'c1', name: 'Wages', amount: 400000 }],
      nonBillableCost: 1000,
      applicableZone: 'Z2',
    },
    approvalWorkflow: 'Sequential',
    operationsTeamApproval: 'Approved',
    hrWageVetting: 'Approved',
    procurementEquipmentTccCosting: 'Pending',
    commercialVetting: 'Pending',
    financeViabilityReview: 'Pending',
    commercialGreenSignal: 'Pending',
    finalRemarks: 'Ready for review',
    signOffName: 'Test Surveyor',
    projectRemarks: 'Project fixture',
    siteSurveyDoneBy: 'Test Surveyor',
    signaturePlaceholder: 'fixture-signature',
    legacyCustomSection: { retained: true },
  };
}

function assertContains(actual, expected, path = 'survey') {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} should remain an array`);
    assert.equal(actual.length, expected.length, `${path} length changed`);
    expected.forEach((value, index) => assertContains(actual[index], value, `${path}[${index}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${path} should remain an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertContains(actual[key], value, `${path}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, `${path} changed`);
}

test('current 14-section payload saves and reloads without field loss', () => {
  const survey = completeSurvey();
  const row = surveyToDbAssessment(survey, visit, 'Draft', {
    email: 'surveyor@example.test',
  });
  const restored = dbAssessmentToSurvey(row);

  for (const [key, value] of Object.entries(survey)) {
    assertContains(restored[key], value, key);
  }
});

test('unknown legacy keys remain preserved in the version-1 snapshot', () => {
  const survey = {
    ...completeSurvey(),
    futureUnknownKey: {
      nested: ['value', { preserved: true }],
    },
  };
  const row = surveyToDbAssessment(survey, visit);

  assert.equal(row.metadata.survey_schema_version, 1);
  assert.deepEqual(
    dbAssessmentToSurvey(row).futureUnknownKey,
    survey.futureUnknownKey,
  );
});

test('version-1 assessment without snapshot restores all mapped fields', () => {
  const stored = surveyToDbAssessment(completeSurvey(), visit);
  delete stored.metadata;
  const restored = dbAssessmentToSurvey(stored);

  assert.equal(restored.siteSurveyDate, '2026-07-29');
  assert.equal(restored.minimumWagesType, 'State');
  assert.equal(restored.clientCreditRating, 'A');
  assert.equal(restored.operationsTeamApproval, 'Approved');
  assert.equal(restored.projectRemarks, 'Project fixture');
});

test('empty optional sections remain valid', () => {
  const row = surveyToDbAssessment(
    {
      siteAddress: 'Only required data',
      commercial: { billingComponents: [] },
    },
    visit,
  );
  const restored = dbAssessmentToSurvey(row);

  assert.deepEqual(restored.ifmScope, {});
  assert.deepEqual(restored.manpowerPlan, []);
  assert.deepEqual(restored.equipment, []);
  assert.deepEqual(restored.risks, []);
});
