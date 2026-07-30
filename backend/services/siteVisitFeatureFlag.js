export function isSiteVisitWorkflowEnabled(env = process.env) {
  return String(env.SITE_VISIT_WORKFLOW_ENABLED ?? '').trim().toLowerCase() === 'true';
}
