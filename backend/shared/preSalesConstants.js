export const PRE_SALES_FEEDBACK = Object.freeze({
  RNR: 'rnr',
  CALL_BACK: 'call_back',
  FUTURE_FOLLOWUP: 'future_followup',
  NO_REQUIREMENT: 'no_requirement',
  INVALID_LEAD: 'invalid_lead',
  INTERESTED: 'interested',
});

export const PRE_SALES_FEEDBACK_LABELS = Object.freeze({
  rnr: 'RNR',
  call_back: 'Call Back',
  future_followup: 'Future Follow-up',
  no_requirement: 'No Requirement',
  invalid_lead: 'Invalid Lead',
  interested: 'Interested / Lead',
});

export const PRE_SALES_STAGES = Object.freeze({
  NEW_LEAD: 'new_lead',
  ASSIGNED: 'pre_sales_assigned',
  CALLING: 'calling',
  FOLLOW_UP: 'follow_up',
  MEETING_SCHEDULED: 'meeting_scheduled',
  MEETING_COMPLETED: 'meeting_completed',
  QUALIFICATION: 'qualification',
  PENDING_HANDOVER: 'pending_bd_handover',
  BD_ACCEPTED: 'bd_accepted',
  INVALID: 'invalid',
});

export const PRE_SALES_STAGE_LABELS = Object.freeze({
  new_lead: 'New Lead',
  pre_sales_assigned: 'Pre-Sales Assigned',
  calling: 'Calling',
  follow_up: 'Follow-up',
  meeting_scheduled: 'Meeting Scheduled',
  meeting_completed: 'Meeting Completed',
  qualification: 'Qualification',
  pending_bd_handover: 'Pending BD Handover',
  bd_accepted: 'BD Accepted',
  invalid: 'Invalid',
});

export const FOLLOWUP_STATUSES = Object.freeze(['pending', 'completed', 'missed', 'cancelled']);
export const MEETING_STATUSES = Object.freeze(['scheduled', 'completed', 'cancelled', 'rescheduled']);
export const HANDOFF_STATUSES = Object.freeze(['pending', 'accepted', 'rejected']);
export const MEETING_MODES = Object.freeze(['in_person', 'video', 'phone']);

export const FEEDBACK_REQUIRING_FOLLOWUP = Object.freeze([
  PRE_SALES_FEEDBACK.RNR,
  PRE_SALES_FEEDBACK.CALL_BACK,
  PRE_SALES_FEEDBACK.FUTURE_FOLLOWUP,
]);

export function preSalesStageLabel(value) {
  return PRE_SALES_STAGE_LABELS[value] || value || 'New Lead';
}

export function feedbackLabel(value) {
  return PRE_SALES_FEEDBACK_LABELS[value] || value || 'Update';
}
