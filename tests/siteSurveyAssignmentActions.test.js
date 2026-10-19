import assert from 'node:assert/strict';
import test from 'node:test';
import { getSiteSurveyAssignmentActions } from '../src/utils/siteSurveyAssignmentActions.js';

const assigned = {
  assigned_operations_manager_profile_id: 'om-1',
  assignment_version: 3,
};

test('pending canonical assignment exposes Accept and Unable to Attend to the assignee view', () => {
  assert.deepEqual(getSiteSurveyAssignmentActions({ ...assigned, acceptance_status: 'pending_acceptance' }), {
    showAccept: true,
    showUnableToAttend: true,
    showOpenSiteSurvey: false,
  });
});

test('accepted assignment exposes only Open Site Survey', () => {
  assert.deepEqual(getSiteSurveyAssignmentActions({ ...assigned, acceptance_status: 'accepted' }), {
    showAccept: false,
    showUnableToAttend: false,
    showOpenSiteSurvey: true,
  });
});

test('declined, unauthorized, and non-versioned legacy assignments expose no assignee actions', () => {
  assert.equal(getSiteSurveyAssignmentActions({ ...assigned, acceptance_status: 'unable_to_attend' }).showAccept, false);
  assert.equal(getSiteSurveyAssignmentActions({ ...assigned, acceptance_status: 'pending_acceptance' }, { canAssignOperationsManager: true }).showAccept, false);
  assert.equal(getSiteSurveyAssignmentActions({ ...assigned, acceptance_status: 'pending_acceptance', assignment_version: 0 }).showAccept, false);
  assert.equal(getSiteSurveyAssignmentActions({ ...assigned, acceptance_status: 'pending_acceptance', assignment_version: undefined }).showAccept, false);
});
