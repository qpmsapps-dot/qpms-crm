begin;

-- Migration 103 records Supervisor self-acceptance as a distinct operational
-- ownership transition. Preserve every existing assignment-history value and
-- add only the two values written by rpc_accept_hospital_operational_ticket.
alter table public.hospital_ticket_assignment_history
  drop constraint if exists hospital_ticket_assignment_history_type_check;

alter table public.hospital_ticket_assignment_history
  add constraint hospital_ticket_assignment_history_type_check
  check (
    assignment_type is null
    or assignment_type in (
      'primary',
      'backup',
      'overall_fallback',
      'operations_fallback',
      'acceptance_escalation',
      'manual_reassignment',
      'operational_owner'
    )
  );

alter table public.hospital_ticket_assignment_history
  drop constraint if exists hospital_ticket_assignment_history_source_check;

alter table public.hospital_ticket_assignment_history
  add constraint hospital_ticket_assignment_history_source_check
  check (
    source in (
      'automatic',
      'manual',
      'escalation',
      'handover',
      'takeover',
      'unassigned',
      'self_acceptance'
    )
  );

comment on constraint hospital_ticket_assignment_history_type_check
  on public.hospital_ticket_assignment_history is
  'Allows routing, fallback, escalation, reassignment, and operational Supervisor ownership history types.';

comment on constraint hospital_ticket_assignment_history_source_check
  on public.hospital_ticket_assignment_history is
  'Allows existing assignment sources plus atomic Supervisor self-acceptance recorded by the operational acceptance RPC.';

commit;
