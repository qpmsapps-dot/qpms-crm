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

  static const criticalSla = Duration(minutes: 10);
  static const mediumSla = Duration(minutes: 15);
  static const lowSla = Duration(minutes: 20);
  static const nearBreachWindow = Duration(minutes: 5);

  DateTime? dueAt(HospitalTicket ticket) {
    if (ticket.isFinal || ticket.isAwaitingClient) return null;
    if (ticket.escalationDueAt != null) return ticket.escalationDueAt;
    if (ticket.status == HospitalTicketStatus.escalatedOperationsExecutive) {
      return ticket.operationsDueAt ??
          (ticket.operationsEscalatedAt ?? ticket.raisedAt).add(
            priorityWindow(ticket.priority),
          );
    }
    if (ticket.status == HospitalTicketStatus.escalatedFacilityManager) {
      return ticket.operationsDueAt ??
          (ticket.facilityEscalatedAt ?? ticket.raisedAt).add(
            priorityWindow(ticket.priority),
          );
    }
    if (ticket.status == HospitalTicketStatus.escalatedProjectHead) {
      return ticket.operationsDueAt ??
          (ticket.facilityEscalatedAt ?? ticket.raisedAt).add(
            priorityWindow(ticket.priority),
          );
    }
    if (_isUnassigned(ticket)) return null;
    return ticket.supervisorDueAt ??
        ticket.raisedAt.add(priorityWindow(ticket.priority));
  }

  Duration priorityWindow(HospitalPriority priority) => switch (priority) {
    HospitalPriority.high => criticalSla,
    HospitalPriority.medium => mediumSla,
    HospitalPriority.low => lowSla,
  };

  HospitalSlaSnapshot snapshot(HospitalTicket ticket, DateTime now) {
    final due = dueAt(ticket);
    if (due == null) {
      return HospitalSlaSnapshot(
        state: HospitalSlaState.notApplicable,
        referenceTime: null,
        remaining: Duration.zero,
        label: _isUnassigned(ticket)
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

  bool _isUnassigned(HospitalTicket ticket) =>
      ticket.responsiblePerson == 'Assignment pending' ||
      ticket.responsibleRole.trim().isEmpty;

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
      operationsDueAt: escalatedAt.add(priorityWindow(ticket.priority)),
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
      operationsDueAt: escalatedAt.add(priorityWindow(ticket.priority)),
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
