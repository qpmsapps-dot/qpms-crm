function field(item, snakeCase, camelCase) {
  return item?.[snakeCase] ?? item?.[camelCase];
}

export function isSiteSurveyAssigneeRole(user = {}) {
  return ['Operations Manager', 'KAM'].includes(String(user.role || '').trim());
}

export function shouldLoadLeadManagementData(user = {}) {
  return !isSiteSurveyAssigneeRole(user);
}

export function canOpenAssignedSiteSurveyForUser(item = {}, user = {}) {
  if (!isSiteSurveyAssigneeRole(user)) return true;
  const profileId = String(user.profileId || '').trim();
  const assignedProfileId = String(field(
    item,
    'assigned_operations_manager_profile_id',
    'assignedOperationsManagerProfileId',
  ) || '').trim();
  const acceptedByProfileId = String(field(
    item,
    'accepted_by_profile_id',
    'acceptedByProfileId',
  ) || '').trim();
  const assignmentVersion = Number(field(item, 'assignment_version', 'assignmentVersion'));
  const acceptanceStatus = String(field(item, 'acceptance_status', 'acceptanceStatus') || '')
    .trim()
    .toLowerCase();
  return Boolean(profileId)
    && assignedProfileId === profileId
    && acceptedByProfileId === profileId
    && acceptanceStatus === 'accepted'
    && Number.isSafeInteger(assignmentVersion)
    && assignmentVersion > 0;
}

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
