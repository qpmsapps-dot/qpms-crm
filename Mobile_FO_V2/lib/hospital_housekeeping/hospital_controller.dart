import 'dart:async';

import 'package:flutter/foundation.dart';

import 'hospital_access_policy.dart';
import 'hospital_demo_repository.dart';
import 'hospital_models.dart';
import 'hospital_sla_policy.dart';
import 'hospital_ticket_api.dart';

class HospitalDashboardSummary {
  const HospitalDashboardSummary({
    required this.newComplaints,
    required this.open,
    required this.assigned,
    required this.inProgress,
    required this.nearBreach,
    required this.escalated,
    required this.awaitingConfirmation,
    required this.reopened,
    required this.closedToday,
  });

  final int newComplaints;
  final int open;
  final int assigned;
  final int inProgress;
  final int nearBreach;
  final int escalated;
  final int awaitingConfirmation;
  final int reopened;
  final int closedToday;
}

class HospitalController extends ChangeNotifier {
  HospitalController({
    required this.session,
    HospitalDemoRepository? repository,
    HospitalAccessPolicy? accessPolicy,
    HospitalSlaPolicy? slaPolicy,
    bool? productionMode,
  }) : _repository = repository ?? HospitalDemoRepository(),
       accessPolicy = accessPolicy ?? const HospitalAccessPolicy(),
       slaPolicy = slaPolicy ?? const HospitalSlaPolicy(),
       productionMode = productionMode ?? !session.isDemo {
    _now = _repository.seedTime;
    _tickets = this.productionMode ? [] : _repository.loadTickets();
  }

  final HospitalDemoSession session;
  final HospitalDemoRepository _repository;
  final HospitalAccessPolicy accessPolicy;
  final HospitalSlaPolicy slaPolicy;
  final bool productionMode;
  bool _loading = false;
  String? _error;
  late List<HospitalTicket> _tickets;
  late DateTime _now;
  int _nextTicketNumber = 109;

  DateTime get now => _now;
  bool get isLoading => _loading;
  String? get error => _error;
  List<HospitalTicket> get allTickets => List.unmodifiable(_tickets);
  List<Map<String, dynamic>> _notifications = [];
  List<Map<String, dynamic>> get notifications =>
      List.unmodifiable(_notifications);

  List<HospitalTicket> get visibleTickets {
    final rows = accessPolicy.visibleTickets(session, _tickets);
    rows.sort(_urgentComparator);
    return rows;
  }

  List<HospitalTicket> get urgentTickets => visibleTickets
      .where((ticket) => !ticket.isFinal && !ticket.isAwaitingClient)
      .toList();

  HospitalTicket ticketById(String id) =>
      _tickets.firstWhere((ticket) => ticket.id == id);

  Future<void> load() async {
    if (!productionMode) return;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        HospitalTicketApi.fetchTickets(),
        HospitalTicketApi.fetchNotifications(),
      ]);
      _tickets = results[0] as List<HospitalTicket>;
      _notifications = results[1] as List<Map<String, dynamic>>;
      _now = DateTime.now();
    } catch (error) {
      _error = error.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> markNotificationRead(String id) async {
    if (!productionMode) return;
    await HospitalTicketApi.markNotificationRead(id);
    _notifications = _notifications
        .map((row) => row['id'] == id ? {...row, 'read_at': DateTime.now().toIso8601String()} : row)
        .toList();
    notifyListeners();
  }

  Future<void> loadDetail(String ticketId) async {
    if (!productionMode) return;
    try {
      final response = await HospitalTicketApi.fetchDetail(ticketId);
      final row = Map<String, dynamic>.from(response['ticket'] as Map);
      final timeline = response['timeline'] is List
          ? response['timeline'] as List
          : const [];
      final complaintPhotos = <String>[];
      final progressPhotos = <String>[];
      final completionPhotos = <String>[];
      final attachments = response['attachments'] is List
          ? response['attachments'] as List
          : const [];
      for (final attachment in attachments.whereType<Map>()) {
        final url = await HospitalTicketApi.signedDownload(
          '${row['id']}',
          '${attachment['id']}',
        );
        switch (attachment['attachment_type']) {
          case 'complaint_photo':
            complaintPhotos.add(url);
            break;
          case 'progress_photo':
            progressPhotos.add(url);
            break;
          case 'completion_photo':
            completionPhotos.add(url);
            break;
        }
      }
      final ticket = HospitalTicket.fromApi(row).copyWith(
        complaintPhotoPaths: complaintPhotos,
        progressPhotoPaths: progressPhotos,
        completionPhotoPaths: completionPhotos,
        events: timeline.whereType<Map>().map((event) {
          return HospitalTicketEvent(
            action: '${event['event_type'] ?? 'update'}'.replaceAll('_', ' '),
            actor: '${event['actor_name'] ?? 'QPMS'}',
            actorRole: '${event['actor_role'] ?? 'system'}',
            occurredAt:
                DateTime.tryParse('${event['created_at'] ?? ''}')?.toLocal() ??
                DateTime.now(),
            remarks: '${event['remarks'] ?? ''}',
            hasPhoto: event['event_type'] == 'photo_uploaded',
          );
        }).toList(),
      );
      _replace(ticket);
    } catch (error) {
      _error = error.toString();
      notifyListeners();
    }
  }

  HospitalSlaSnapshot slaFor(HospitalTicket ticket) =>
      slaPolicy.snapshot(ticket, _now);

  Set<HospitalTicketAction> actionsFor(HospitalTicket ticket) => productionMode
      ? accessPolicy
            .allowedActions(session, ticket)
            .where(
              (action) => !{
                HospitalTicketAction.simulateSupervisorBreach,
                HospitalTicketAction.simulateOperationsBreach,
                HospitalTicketAction.simulateClientSatisfied,
                HospitalTicketAction.simulateClientNotSatisfied,
              }.contains(action),
            )
            .toSet()
      : accessPolicy.allowedActions(session, ticket);

  HospitalDashboardSummary get summary {
    final rows = visibleTickets;
    int count(HospitalTicketStatus status) =>
        rows.where((ticket) => ticket.status == status).length;
    return HospitalDashboardSummary(
      newComplaints: rows
          .where(
            (ticket) =>
                ticket.status == HospitalTicketStatus.open &&
                _now.difference(ticket.raisedAt) <= const Duration(minutes: 10),
          )
          .length,
      open: count(HospitalTicketStatus.open),
      assigned: count(HospitalTicketStatus.assigned),
      inProgress:
          count(HospitalTicketStatus.accepted) +
          count(HospitalTicketStatus.inProgress),
      nearBreach: rows
          .where(
            (ticket) => slaFor(ticket).state == HospitalSlaState.nearBreach,
          )
          .length,
      escalated:
          count(HospitalTicketStatus.escalatedOperationsExecutive) +
          count(HospitalTicketStatus.escalatedFacilityManager),
      awaitingConfirmation: count(
        HospitalTicketStatus.resolvedAwaitingConfirmation,
      ),
      reopened: count(HospitalTicketStatus.reopened),
      closedToday: rows
          .where(
            (ticket) =>
                ticket.status == HospitalTicketStatus.closed &&
                ticket.events.any(
                  (event) =>
                      event.action == 'Final closure' &&
                      _sameDate(event.occurredAt, _now),
                ),
          )
          .length,
    );
  }

  void updateClock(DateTime value, {bool applyEscalations = true}) {
    _now = value;
    if (applyEscalations) _reconcileSla();
    notifyListeners();
  }

  void advanceDemoTime(Duration duration) {
    _now = _now.add(duration);
    _reconcileSla();
    notifyListeners();
  }

  void accept(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.accept);
    if (productionMode) {
      unawaited(_remoteAction(ticket, 'accept'));
      return;
    }
    _replace(
      ticket.copyWith(
        status: HospitalTicketStatus.accepted,
        responsiblePerson: session.displayName,
        responsibleRole: session.role.label,
        events: [
          ...ticket.events,
          _event('Accepted', 'Complaint accepted for action.'),
        ],
      ),
    );
  }

  void startWork(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.startWork);
    if (productionMode) {
      unawaited(_remoteAction(ticket, 'start-work'));
      return;
    }
    _replace(
      ticket.copyWith(
        status: HospitalTicketStatus.inProgress,
        events: [
          ...ticket.events,
          _event('Work started', 'Housekeeping work started.'),
        ],
      ),
    );
  }

  void addUpdate(
    String ticketId, {
    required String remarks,
    String? photoPath,
    String action = 'Progress update',
  }) {
    final ticket = ticketById(ticketId);
    if (!accessPolicy.canView(session, ticket)) {
      throw StateError('Ticket is outside the assigned scope.');
    }
    if (remarks.trim().isEmpty) throw ArgumentError('Remarks are required.');
    if (productionMode) {
      unawaited(_remoteProgress(ticket, remarks.trim(), photoPath));
      return;
    }
    _replace(
      ticket.copyWith(
        progressPhotoPaths: photoPath == null
            ? ticket.progressPhotoPaths
            : [...ticket.progressPhotoPaths, photoPath],
        events: [
          ...ticket.events,
          _event(action, remarks.trim(), hasPhoto: photoPath != null),
        ],
      ),
    );
  }

  void resolve(
    String ticketId, {
    required String actionTaken,
    required String resolutionRemarks,
    required String completionPhotoPath,
  }) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.resolve);
    if (actionTaken.trim().isEmpty || resolutionRemarks.trim().isEmpty) {
      throw ArgumentError('Action taken and resolution remarks are required.');
    }
    if (completionPhotoPath.trim().isEmpty) {
      throw ArgumentError('A completion photo is required.');
    }
    if (productionMode) {
      unawaited(
        _remoteResolve(
          ticket,
          actionTaken,
          resolutionRemarks,
          completionPhotoPath,
        ),
      );
      return;
    }
    _replace(
      ticket.copyWith(
        status: HospitalTicketStatus.resolvedAwaitingConfirmation,
        resolvedAt: _now,
        actionTaken: actionTaken.trim(),
        resolutionRemarks: resolutionRemarks.trim(),
        completionPhotoPaths: [
          ...ticket.completionPhotoPaths,
          completionPhotoPath,
        ],
        events: [
          ...ticket.events,
          _event('Resolution', resolutionRemarks.trim(), hasPhoto: true),
          HospitalTicketEvent(
            action: 'Client confirmation requested',
            actor: 'Demo Client Sync',
            actorRole: 'System',
            occurredAt: _now,
            remarks: 'Waiting for client satisfaction confirmation.',
          ),
        ],
      ),
    );
  }

  void requestAssistance(String ticketId, String remarks) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.requestAssistance);
    if (productionMode) {
      unawaited(
        _remoteAction(ticket, 'request-assistance', {
          'remarks': remarks.trim(),
        }),
      );
      return;
    }
    addUpdate(ticketId, remarks: remarks, action: 'Assistance requested');
  }

  void takeOver(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.takeOver);
    if (productionMode) {
      unawaited(_remoteAction(ticket, 'take-over'));
      return;
    }
    _replace(
      ticket.copyWith(
        responsiblePerson: session.displayName,
        responsibleRole: session.role.label,
        events: [
          ...ticket.events,
          _event('Taken over', '${session.role.label} took responsibility.'),
        ],
      ),
    );
  }

  void reassignSupervisor(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.reassignSupervisor);
    if (productionMode) {
      unawaited(
        _remoteAction(ticket, 'reassign-supervisor', {
          'remarks': 'Reassigned to the block Housekeeping Supervisor.',
        }),
      );
      return;
    }
    _replace(
      ticket.copyWith(
        responsiblePerson: ticket.supervisorName,
        responsibleRole: HospitalDemoRole.supervisor.label,
        events: [
          ...ticket.events,
          _event(
            'Reassigned to Supervisor',
            '${ticket.supervisorName} assigned for immediate support.',
          ),
        ],
      ),
    );
  }

  void assignSupport(String ticketId, String remarks) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.assignSupport);
    if (productionMode) {
      unawaited(
        _remoteAction(ticket, 'assign-support', {'remarks': remarks.trim()}),
      );
      return;
    }
    addUpdate(ticketId, remarks: remarks, action: 'Support assigned');
  }

  void simulateSupervisorBreach(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.simulateSupervisorBreach);
    _replace(
      slaPolicy.escalateSupervisorBreach(
        ticket,
        _now,
        reason: 'Demo-only Supervisor SLA breach simulation.',
      ),
    );
  }

  void escalateManually(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.escalateManually);
    if (productionMode) {
      unawaited(
        _remoteAction(ticket, 'escalate', {
          'remarks': 'Manually escalated for operational support.',
        }),
      );
      return;
    }
    _replace(
      slaPolicy.escalateSupervisorBreach(
        ticket,
        _now,
        reason: 'Manually escalated for immediate operational support.',
      ),
    );
  }

  void simulateOperationsBreach(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.simulateOperationsBreach);
    _replace(
      slaPolicy.escalateOperationsBreach(
        ticket,
        _now,
        reason: 'Demo-only Operations Executive SLA breach simulation.',
      ),
    );
  }

  void escalateFurther(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.escalateFurther);
    if (productionMode) {
      unawaited(
        _remoteAction(ticket, 'escalate', {
          'remarks': 'Escalated for Facility Manager oversight.',
        }),
      );
      return;
    }
    _replace(
      slaPolicy.escalateOperationsBreach(
        ticket,
        _now,
        reason: 'Escalated further for Facility Manager oversight.',
      ),
    );
  }

  void simulateClientFeedback(
    String ticketId, {
    required bool satisfied,
    required int rating,
    required String comments,
  }) {
    final ticket = ticketById(ticketId);
    final requiredAction = satisfied
        ? HospitalTicketAction.simulateClientSatisfied
        : HospitalTicketAction.simulateClientNotSatisfied;
    _requireAction(ticket, requiredAction);
    if (!satisfied && comments.trim().isEmpty) {
      throw ArgumentError('Client comments are required when reopening.');
    }
    final nextStatus = satisfied
        ? HospitalTicketStatus.closed
        : HospitalTicketStatus.reopened;
    _replace(
      ticket.copyWith(
        status: nextStatus,
        responsiblePerson: satisfied
            ? ticket.responsiblePerson
            : ticket.supervisorName,
        responsibleRole: satisfied
            ? ticket.responsibleRole
            : HospitalDemoRole.supervisor.label,
        clientRating: rating,
        clientFeedback: comments.trim(),
        clientSatisfied: satisfied,
        reopenedCount: satisfied
            ? ticket.reopenedCount
            : ticket.reopenedCount + 1,
        events: [
          ...ticket.events,
          HospitalTicketEvent(
            action: satisfied ? 'Final closure' : 'Reopen',
            actor: 'Hospital Client User',
            actorRole: 'Client',
            occurredAt: _now,
            remarks: satisfied
                ? 'Client marked Satisfied. Rating: $rating/5. ${comments.trim()}'
                : 'Client marked Not Satisfied. ${comments.trim()}',
          ),
        ],
      ),
    );
  }

  HospitalTicket simulateNewClientComplaint({String? block}) {
    if (productionMode) {
      throw StateError(
        'Client complaint simulation is disabled in production mode.',
      );
    }
    final targetBlock = session.role == HospitalDemoRole.supervisor
        ? session.assignedBlock!
        : block ?? 'Block A';
    final ticket = HospitalTicket(
      id: 'QPMS-HH-2026-${_nextTicketNumber.toString().padLeft(4, '0')}',
      block: targetBlock,
      floor: '2nd Floor',
      location: 'Patient Ward Corridor',
      category: 'General Cleaning',
      priority: HospitalPriority.high,
      description: 'Housekeeping support delayed in patient ward corridor.',
      reportedBy: 'Hospital Client User',
      raisedAt: _now,
      status: HospitalTicketStatus.open,
      responsiblePerson: 'Supervisor - $targetBlock',
      responsibleRole: HospitalDemoRole.supervisor.label,
      supervisorName: 'Supervisor - $targetBlock',
      supervisorDueAt: _now.add(HospitalSlaPolicy.supervisorSla),
      complaintPhotoPaths: const ['demo://new-complaint'],
      events: [
        HospitalTicketEvent(
          action: 'Complaint created',
          actor: 'Hospital Client User',
          actorRole: 'Client',
          occurredAt: _now,
          remarks:
              'New complaint received from Client Ticketing App simulation.',
          hasPhoto: true,
        ),
        HospitalTicketEvent(
          action: 'Supervisor notified',
          actor: 'Demo Client Sync',
          actorRole: 'System',
          occurredAt: _now,
          remarks: 'Assigned block supervisor notified.',
        ),
      ],
    );
    _nextTicketNumber += 1;
    _tickets = [ticket, ..._tickets];
    notifyListeners();
    return ticket;
  }

  void _reconcileSla() {
    _tickets = _tickets.map((ticket) {
      final due = slaPolicy.dueAt(ticket);
      if (due == null || due.isAfter(_now)) return ticket;
      if (ticket.status == HospitalTicketStatus.escalatedOperationsExecutive) {
        return slaPolicy.escalateOperationsBreach(ticket, _now);
      }
      if (ticket.status != HospitalTicketStatus.escalatedFacilityManager) {
        return slaPolicy.escalateSupervisorBreach(ticket, _now);
      }
      return ticket;
    }).toList();
  }

  int _urgentComparator(HospitalTicket left, HospitalTicket right) {
    final leftSla = slaFor(left);
    final rightSla = slaFor(right);
    final leftRank = _slaRank(leftSla.state);
    final rightRank = _slaRank(rightSla.state);
    if (leftRank != rightRank) return leftRank.compareTo(rightRank);
    if (leftSla.remaining != rightSla.remaining) {
      return leftSla.remaining.compareTo(rightSla.remaining);
    }
    if (left.priority != right.priority) {
      return right.priority.index.compareTo(left.priority.index);
    }
    return left.raisedAt.compareTo(right.raisedAt);
  }

  int _slaRank(HospitalSlaState state) => switch (state) {
    HospitalSlaState.breached => 0,
    HospitalSlaState.nearBreach => 1,
    HospitalSlaState.healthy => 2,
    HospitalSlaState.notApplicable => 3,
  };

  void _replace(HospitalTicket ticket) {
    _tickets = _tickets
        .map((current) => current.id == ticket.id ? ticket : current)
        .toList();
    notifyListeners();
  }

  Future<void> _remoteAction(
    HospitalTicket ticket,
    String path, [
    Map<String, dynamic> payload = const {},
  ]) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      await HospitalTicketApi.action(ticket.id, path, ticket.version, payload);
      await load();
    } catch (error) {
      _loading = false;
      _error = error.toString();
      notifyListeners();
    }
  }

  Future<void> _remoteProgress(
    HospitalTicket ticket,
    String remarks,
    String? photoPath,
  ) async {
    try {
      if (photoPath != null) {
        await HospitalTicketApi.uploadPhoto(
          ticket.id,
          photoPath,
          'progress_photo',
        );
      }
      await _remoteAction(ticket, 'progress', {'remarks': remarks});
    } catch (error) {
      _error = error.toString();
      notifyListeners();
    }
  }

  Future<void> _remoteResolve(
    HospitalTicket ticket,
    String actionTaken,
    String remarks,
    String photoPath,
  ) async {
    try {
      await HospitalTicketApi.uploadPhoto(
        ticket.id,
        photoPath,
        'completion_photo',
      );
      await _remoteAction(ticket, 'resolve', {
        'resolution_action': actionTaken.trim(),
        'resolution_remarks': remarks.trim(),
      });
    } catch (error) {
      _error = error.toString();
      notifyListeners();
    }
  }

  HospitalTicketEvent _event(
    String action,
    String remarks, {
    bool hasPhoto = false,
  }) => HospitalTicketEvent(
    action: action,
    actor: session.displayName,
    actorRole: session.role.label,
    occurredAt: _now,
    remarks: remarks,
    hasPhoto: hasPhoto,
  );

  void _requireAction(HospitalTicket ticket, HospitalTicketAction action) {
    if (!actionsFor(ticket).contains(action)) {
      throw StateError('${action.name} is not allowed for this ticket.');
    }
  }

  static bool _sameDate(DateTime left, DateTime right) =>
      left.year == right.year &&
      left.month == right.month &&
      left.day == right.day;
}
