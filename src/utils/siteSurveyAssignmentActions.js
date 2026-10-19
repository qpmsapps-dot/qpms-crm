export function getSiteSurveyAssignmentActions(item = {}, { canAssignOperationsManager = false } = {}) {
  const assignmentVersion = Number(item.assignment_version);
  const hasCanonicalAssignment = Boolean(item.assigned_operations_manager_profile_id)
    && Number.isSafeInteger(assignmentVersion)
    && assignmentVersion > 0;
  const pending = item.acceptance_status === 'pending_acceptance' && hasCanonicalAssignment;

  return {
    showAccept: !canAssignOperationsManager && pending,
    showUnableToAttend: !canAssignOperationsManager && pending,
    showOpenSiteSurvey: item.acceptance_status === 'accepted' && hasCanonicalAssignment,
  };
}
