const millis = (value) => value ? Date.parse(value) : NaN;
export function siteSurveyTat(visit, now = Date.now()) {
  const tat=visit.metadata?.survey_tat;
  if(!tat)return null; // Historical tasks are not given new clocks.
  const submitted=millis(tat.submitted_at), assigned=millis(tat.assigned_at);
  const waiting= !Number.isFinite(assigned);
  const deadline=waiting?tat.assignment_deadline:tat.survey_deadline;
  const late=Number.isFinite(submitted) && submitted>millis(tat.survey_deadline);
  const overdue72=!waiting && (Number.isFinite(submitted)?submitted:now)>=millis(tat.overdue_deadline);
  const escalated=!waiting && (Number.isFinite(submitted)?submitted:now)>=millis(tat.survey_deadline);
  const elapsed=(Number.isFinite(submitted)?submitted:now)-millis(deadline);
  return { ...tat, deadline, waiting_assignment:waiting,
    assignment_status:visit.acceptance_status || 'Pending Branch Head Assignment',
    survey_status:Number.isFinite(submitted)?(late?'Completed late':'Completed'):waiting?'Pending Assignment':overdue72?'Overdue':escalated?'Escalated':'In progress',
    remaining_ms:Number.isFinite(elapsed)?Math.max(0,-elapsed):null,
    overdue_ms:Number.isFinite(elapsed)?Math.max(0,elapsed):null,
    escalation_status:tat.escalation_status || (escalated?'Escalation pending processing':'Not escalated'),
    late_completion:late,completed_after_72h:overdue72 && Number.isFinite(submitted),
  };
}
