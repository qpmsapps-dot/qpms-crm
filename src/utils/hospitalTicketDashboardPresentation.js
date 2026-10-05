const ESCALATION_LABELS = {
  operations_executive: 'Operations Executive',
  facility_manager: 'Facility Manager',
  project_head: 'Project Head',
  dean: 'Dean',
  hospital_dean: 'Dean',
};

const ESCALATION_LABELS_BY_LEVEL = {
  2: 'Operations Executive',
  3: 'Facility Manager',
  4: 'Project Head',
  5: 'Dean',
};

export function ticketAcceptancePresentation(ticket = {}) {
  const status = String(ticket.acceptance_status || '').trim().toLowerCase();
  if (status === 'accepted' || ticket.accepted_by?.id) {
    return { label: 'Accepted', tone: 'accepted' };
  }
  if (status === 'timed_out') {
    return { label: 'Timed Out', tone: 'timed_out' };
  }
  return { label: 'Not Accepted', tone: 'not_accepted' };
}

export function ticketEscalationLabel(ticket = {}) {
  const level = String(ticket.current_escalation_level || '').trim().toLowerCase();
  if (level === 'supervisor') return '—';
  if (level) return ESCALATION_LABELS[level] || '—';
  return ESCALATION_LABELS_BY_LEVEL[Number(ticket.current_escalation_level_no)] || '—';
}
