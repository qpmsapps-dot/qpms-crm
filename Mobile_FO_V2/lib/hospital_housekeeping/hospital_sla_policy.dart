import 'hospital_models.dart';

enum HospitalSlaState { healthy, nearBreach, breached, notApplicable }

class HospitalSlaSnapshot {
  const HospitalSlaSnapshot({
    required this.state,
    required this.referenceTime,
    required this.remaining,
    required this.label,
  });

  final HospitalSlaState state;
  final DateTime? referenceTime;
  final Duration remaining;
  final String label;
}

class HospitalSlaPolicy {
  const HospitalSlaPolicy();

  static const supervisorSla = Duration(minutes: 20);
  static const operationsSla = Duration(minutes: 30);
  static const nearBreachWindow = Duration(minutes: 5);

  DateTime? dueAt(HospitalTicket ticket) {
    if (ticket.isFinal || ticket.isAwaitingClient) return null;
    if (ticket.status == HospitalTicketStatus.escalatedOperationsExecutive) {
      return ticket.operationsDueAt;
    }
    if (ticket.status == HospitalTicketStatus.escalatedFacilityManager) {
      return null;
    }
    return ticket.supervisorDueAt;
  }

  HospitalSlaSnapshot snapshot(HospitalTicket ticket, DateTime now) {
    final due = dueAt(ticket);
    if (due == null) {
      final unassigned =
          ticket.responsiblePerson == 'Assignment pending' ||
          ticket.responsibleRole.trim().isEmpty;
      return HospitalSlaSnapshot(
        state: HospitalSlaState.notApplicable,
        referenceTime: null,
        remaining: Duration.zero,
        label: unassigned
            ? 'No supervisor SLA - unassigned'
            : 'Operational oversight',
      );
    }
    final remaining = due.difference(now);
    if (remaining <= Duration.zero) {
      return HospitalSlaSnapshot(
        state: HospitalSlaState.breached,
        referenceTime: due,
        remaining: remaining,
        label: 'SLA breached by ${formatDuration(remaining.abs())}',
      );
    }
    if (remaining <= nearBreachWindow) {
      return HospitalSlaSnapshot(
        state: HospitalSlaState.nearBreach,
        referenceTime: due,
        remaining: remaining,
        label: '${formatDuration(remaining)} remaining',
      );
    }
    return HospitalSlaSnapshot(
      state: HospitalSlaState.healthy,
      referenceTime: due,
      remaining: remaining,
      label: '${formatDuration(remaining)} remaining',
    );
  }

  HospitalTicket escalateSupervisorBreach(
    HospitalTicket ticket,
    DateTime escalatedAt, {
    String reason = 'Supervisor SLA exceeded.',
  }) {
    if (ticket.isFinal || ticket.isAwaitingClient) return ticket;
    return ticket.copyWith(
      status: HospitalTicketStatus.escalatedOperationsExecutive,
      responsiblePerson: 'Arun P.',
      responsibleRole: HospitalDemoRole.operationsExecutive.label,
      operationsEscalatedAt: escalatedAt,
      operationsDueAt: escalatedAt.add(operationsSla),
      events: [
        ...ticket.events,
        HospitalTicketEvent(
          action: 'Escalated to Operations Executive',
          actor: 'Demo SLA Engine',
          actorRole: 'System',
          occurredAt: escalatedAt,
          remarks: reason,
        ),
      ],
    );
  }

  HospitalTicket escalateOperationsBreach(
    HospitalTicket ticket,
    DateTime escalatedAt, {
    String reason = 'Operations Executive SLA exceeded.',
  }) {
    if (ticket.isFinal || ticket.isAwaitingClient) return ticket;
    return ticket.copyWith(
      status: HospitalTicketStatus.escalatedFacilityManager,
      responsiblePerson: 'Priya N.',
      responsibleRole: HospitalDemoRole.facilityManager.label,
      facilityEscalatedAt: escalatedAt,
      events: [
        ...ticket.events,
        HospitalTicketEvent(
          action: 'Escalated to Facility Manager',
          actor: 'Demo SLA Engine',
          actorRole: 'System',
          occurredAt: escalatedAt,
          remarks: reason,
        ),
      ],
    );
  }

  static String formatDuration(Duration value) {
    final seconds = value.inSeconds.abs();
    final minutes = seconds ~/ 60;
    final remainingSeconds = seconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:'
        '${remainingSeconds.toString().padLeft(2, '0')}';
  }
}
