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
    required this.awaitingAcceptance,
    required this.open,
    required this.assigned,
    required this.inProgress,
    required this.dueSoon,
    required this.breached,
    required this.nearBreach,
    required this.escalated,
    required this.awaitingConfirmation,
    required this.reopened,
    required this.closedToday,
    required this.unassigned,
  });

  final int newComplaints;
  final int awaitingAcceptance;
  final int open;
  final int assigned;
  final int inProgress;
  final int dueSoon;
  final int breached;
  final int nearBreach;
  final int escalated;
  final int awaitingConfirmation;
  final int reopened;
  final int closedToday;
  final int unassigned;
}

enum HospitalTicketListFilter {
  all,
  newAssignments,
  awaitingAcceptance,
  inProgress,
  dueSoon,
  breached,
  escalated,
  reopened,
  resolvedToday,
  unassigned,
}

abstract class HospitalTicketGateway {
  Future<List<HospitalTicket>> fetchTickets();
  Future<List<HospitalTicket>> fetchIncomingTickets();
  Future<List<Map<String, dynamic>>> fetchNotifications();
  Future<Map<String, dynamic>> fetchDutyStatus();
  Future<HospitalSupervisorAvailabilitySummary> fetchSupervisorAvailability();
  Future<Map<String, dynamic>> startDuty({String? cugNumber});
  Future<Map<String, dynamic>> endDuty();
  Future<void> markNotificationRead(String id);
  Future<Map<String, dynamic>> fetchDetail(String ticketId);
  Future<String> signedDownload(String ticketId, String attachmentId);
  Future<Map<String, dynamic>> action(
    String ticketId,
    String path,
    int version, [
    Map<String, dynamic> payload = const {},
  ]);
  Future<void> uploadPhoto(String ticketId, String filePath, String type);
}

class LiveHospitalTicketGateway implements HospitalTicketGateway {
  const LiveHospitalTicketGateway();

  @override
  Future<List<HospitalTicket>> fetchTickets() =>
      HospitalTicketApi.fetchTickets();

  @override
  Future<List<HospitalTicket>> fetchIncomingTickets() =>
      HospitalTicketApi.fetchIncomingTickets();

  @override
  Future<List<Map<String, dynamic>>> fetchNotifications() =>
      HospitalTicketApi.fetchNotifications();

  @override
  Future<Map<String, dynamic>> fetchDutyStatus() =>
      HospitalTicketApi.fetchDutyStatus();

  @override
  Future<HospitalSupervisorAvailabilitySummary> fetchSupervisorAvailability() =>
      HospitalTicketApi.fetchSupervisorAvailability();

  @override
  Future<Map<String, dynamic>> startDuty({String? cugNumber}) =>
      HospitalTicketApi.startDuty(cugNumber: cugNumber);

  @override
  Future<Map<String, dynamic>> endDuty() => HospitalTicketApi.endDuty();

  @override
  Future<void> markNotificationRead(String id) =>
      HospitalTicketApi.markNotificationRead(id);

  @override
  Future<Map<String, dynamic>> fetchDetail(String ticketId) =>
      HospitalTicketApi.fetchDetail(ticketId);

  @override
  Future<String> signedDownload(String ticketId, String attachmentId) =>
      HospitalTicketApi.signedDownload(ticketId, attachmentId);

  @override
  Future<Map<String, dynamic>> action(
    String ticketId,
    String path,
    int version, [
    Map<String, dynamic> payload = const {},
  ]) => HospitalTicketApi.action(ticketId, path, version, payload);

  @override
  Future<void> uploadPhoto(String ticketId, String filePath, String type) =>
      HospitalTicketApi.uploadPhoto(ticketId, filePath, type);
}

class HospitalController extends ChangeNotifier {
  HospitalController({
    required this.session,
    HospitalDemoRepository? repository,
    HospitalAccessPolicy? accessPolicy,
    HospitalSlaPolicy? slaPolicy,
    HospitalTicketGateway? api,
    bool? productionMode,
  }) : _repository = repository ?? HospitalDemoRepository(),
       _api = api ?? const LiveHospitalTicketGateway(),
       accessPolicy = accessPolicy ?? const HospitalAccessPolicy(),
       slaPolicy = slaPolicy ?? const HospitalSlaPolicy(),
       productionMode = productionMode ?? !session.isDemo {
    _now = _repository.seedTime;
    _tickets = this.productionMode ? [] : _repository.loadTickets();
  }

  final HospitalDemoSession session;
  final HospitalDemoRepository _repository;
  final HospitalTicketGateway _api;
  final HospitalAccessPolicy accessPolicy;
  final HospitalSlaPolicy slaPolicy;
  final bool productionMode;
  bool _loading = false;
  bool _sessionExpired = false;
  String? _error;
  String? _notificationError;
  late List<HospitalTicket> _tickets;
  late DateTime _now;
  int _nextTicketNumber = 109;
  int _detailRequestSerial = 0;
  final Map<String, int> _detailRequestTokens = {};
  final Set<String> _detailLoadingTicketIds = {};
  final Set<String> _detailRefreshingTicketIds = {};
  final Map<String, String> _detailErrors = {};
  final Map<String, DateTime> _detailLoadedAt = {};
  final Map<String, String> _signedAttachmentUrls = {};

  DateTime get now => _now;
  bool get isLoading => _loading;
  bool get sessionExpired => _sessionExpired;
  String? get error => _error;
  String? get notificationError => _notificationError;
  List<HospitalTicket> get allTickets => List.unmodifiable(_tickets);
  List<Map<String, dynamic>> _notifications = [];
  String _dutyStatus = 'off_duty';
  HospitalSupervisorAvailabilitySummary? _supervisorAvailability;
  final Set<String> _busyTicketIds = {};
  List<Map<String, dynamic>> get notifications =>
      List.unmodifiable(_notifications);
  String get dutyStatus => _dutyStatus;
  bool get isOnDuty => _dutyStatus == 'on_duty';
  HospitalSupervisorAvailabilitySummary? get supervisorAvailability =>
      _supervisorAvailability;
  bool get canViewSupervisorAvailability =>
      session.role == HospitalDemoRole.operationsExecutive ||
      session.role == HospitalDemoRole.facilityManager ||
      session.role == HospitalDemoRole.projectHead;
  bool isTicketBusy(String ticketId) => _busyTicketIds.contains(ticketId);
  bool isDetailLoading(String ticketId) =>
      _detailLoadingTicketIds.contains(ticketId);
  bool isDetailRefreshing(String ticketId) =>
      _detailRefreshingTicketIds.contains(ticketId);
  String? detailError(String ticketId) => _detailErrors[ticketId];
  DateTime? detailLoadedAt(String ticketId) => _detailLoadedAt[ticketId];

  List<HospitalTicket> get visibleTickets {
    final rows = accessPolicy.visibleTickets(session, _tickets);
    rows.sort(_urgentComparator);
    return rows;
  }

  List<HospitalTicket> get urgentTickets => visibleTickets
      .where((ticket) => !ticket.isFinal && !ticket.isAwaitingClient)
      .toList();

  List<HospitalTicket> get incomingTickets => visibleTickets
      .where(
        (ticket) =>
            ticket.status ==
                HospitalTicketStatus.awaitingSupervisorAcceptance &&
            ticket.acceptanceStatus == 'awaiting' &&
            ticket.acceptanceDueAt != null &&
            ticket.acceptanceDueAt!.isAfter(_now),
      )
      .toList();

  List<HospitalTicket> get myAcceptedTickets => visibleTickets
      .where(
        (ticket) =>
            _isAssignedToSession(ticket) &&
            ticket.status != HospitalTicketStatus.awaitingSupervisorAcceptance,
      )
      .toList();

  List<HospitalTicket> filteredTickets({
    HospitalTicketListFilter filter = HospitalTicketListFilter.all,
    HospitalTicketStatus? status,
    HospitalPriority? priority,
    String query = '',
    String block = '',
    String category = '',
    bool assignedToMe = false,
  }) {
    final text = query.trim().toLowerCase();
    return visibleTickets.where((ticket) {
      if (status != null && ticket.status != status) return false;
      if (priority != null && ticket.priority != priority) return false;
      if (block.isNotEmpty && ticket.block != block) return false;
      if (category.isNotEmpty && ticket.category != category) return false;
      if (assignedToMe && !_isAssignedToSession(ticket)) {
        return false;
      }
      if (!_matchesDashboardFilter(ticket, filter)) return false;
      if (text.isEmpty) return true;
      return [
        ticket.id,
        ticket.block,
        ticket.floor,
        ticket.department,
        ticket.location,
        ticket.roomArea,
        ticket.exactLandmark,
        ticket.category,
        ticket.description,
      ].join(' ').toLowerCase().contains(text);
    }).toList();
  }

  HospitalTicket ticketById(String id) => _tickets.firstWhere(
    (ticket) => ticket.id == id || ticket.ticketNumber == id,
  );

  bool _isAssignedToSession(HospitalTicket ticket) {
    final hospitalUserId = session.userId.trim();
    if (hospitalUserId.isNotEmpty) {
      return ticket.currentAssigneeUserId == hospitalUserId ||
          ticket.supervisorUserId == hospitalUserId ||
          ticket.acceptedByUserId == hospitalUserId;
    }
    return ticket.responsiblePerson.trim().toLowerCase() ==
        session.displayName.trim().toLowerCase();
  }

  Future<void> load() async {
    if (!productionMode || _loading || _sessionExpired) return;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        _api.fetchTickets(),
        if (session.role == HospitalDemoRole.supervisor)
          _api.fetchIncomingTickets()
        else
          Future.value(<HospitalTicket>[]),
        _fetchNotificationsWithoutBlockingDashboard(),
        if (session.role == HospitalDemoRole.supervisor)
          _api.fetchDutyStatus()
        else
          Future.value(<String, dynamic>{}),
        if (canViewSupervisorAvailability)
          _fetchSupervisorAvailabilityWithoutBlockingDashboard()
        else
          Future.value(null),
      ]);
      _tickets = _mergeListRefresh([
        ...(results[0] as List<HospitalTicket>),
        ...(results[1] as List<HospitalTicket>),
      ]);
      _notifications = results[2] as List<Map<String, dynamic>>;
      final duty = results[3] is Map ? results[3] as Map : const {};
      final dutyBody = duty['duty'] is Map ? duty['duty'] as Map : duty;
      _dutyStatus = '${dutyBody['duty_status'] ?? _dutyStatus}';
      _supervisorAvailability =
          results[4] as HospitalSupervisorAvailabilitySummary?;
      _now = DateTime.now();
    } catch (error) {
      _error = error.toString();
      if (error is HospitalTicketApiException &&
          const {
            'invalid_token',
            'authentication_required',
            'session_expired',
          }.contains(error.code)) {
        _sessionExpired = true;
      }
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<HospitalSupervisorAvailabilitySummary?>
  _fetchSupervisorAvailabilityWithoutBlockingDashboard() async {
    try {
      return await _api.fetchSupervisorAvailability();
    } catch (_) {
      return _supervisorAvailability;
    }
  }

  Future<List<Map<String, dynamic>>>
  _fetchNotificationsWithoutBlockingDashboard() async {
    try {
      final rows = await _api.fetchNotifications();
      _notificationError = null;
      return rows;
    } catch (error) {
      _notificationError = error is HospitalTicketApiException
          ? error.message
          : 'Unable to load notifications. Retry.';
      return _notifications;
    }
  }

  Future<void> markNotificationRead(String id) async {
    if (!productionMode) return;
    await _api.markNotificationRead(id);
    _notifications = _notifications
        .map(
          (row) => row['id'] == id
              ? {...row, 'read_at': DateTime.now().toIso8601String()}
              : row,
        )
        .toList();
    notifyListeners();
  }

  Future<void> startDuty({String? cugNumber}) async {
    if (!productionMode) {
      _dutyStatus = 'on_duty';
      notifyListeners();
      return;
    }
    final response = await _api.startDuty(cugNumber: cugNumber);
    final duty = response['duty'] is Map ? response['duty'] as Map : response;
    _dutyStatus = '${duty['duty_status'] ?? 'on_duty'}';
    await load();
  }

  Future<void> endDuty() async {
    if (!productionMode) {
      _dutyStatus = 'off_duty';
      notifyListeners();
      return;
    }
    final response = await _api.endDuty();
    final duty = response['duty'] is Map ? response['duty'] as Map : response;
    _dutyStatus = '${duty['duty_status'] ?? 'off_duty'}';
    await load();
  }

  Future<void> loadDetail(
    String ticketId, {
    bool force = false,
    bool retrying = false,
  }) async {
    if (!productionMode) return;
    if (_detailLoadingTicketIds.contains(ticketId) && !force) return;
    final token = ++_detailRequestSerial;
    _detailRequestTokens[ticketId] = token;
    final alreadyLoaded =
        ticketById(ticketId).events.isNotEmpty ||
        _detailLoadedAt.containsKey(ticketId);
    _detailLoadingTicketIds.add(ticketId);
    if (alreadyLoaded) _detailRefreshingTicketIds.add(ticketId);
    _detailErrors.remove(ticketId);
    notifyListeners();
    try {
      final response = await _api.fetchDetail(ticketId);
      if (_detailRequestTokens[ticketId] != token) return;
      final row = Map<String, dynamic>.from(response['ticket'] as Map);
      final timeline = response['timeline'] is List
          ? response['timeline'] as List
          : const [];
      final attachments = response['attachments'] is List
          ? response['attachments'] as List
          : const [];
      final previous = _findTicket('${row['id']}') ?? _findTicket(ticketId);
      final allowedActions = response['allowed_actions'] is List
          ? (response['allowed_actions'] as List)
                .map((value) => hospitalActionFromCode('$value'))
                .whereType<HospitalTicketAction>()
                .toSet()
          : <HospitalTicketAction>{};
      final ticket = HospitalTicket.fromApi(row).copyWith(
        complaintPhotoPaths: previous?.complaintPhotoPaths,
        progressPhotoPaths: previous?.progressPhotoPaths,
        completionPhotoPaths: previous?.completionPhotoPaths,
        allowedActions: allowedActions,
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
      _detailLoadedAt[ticket.id] = DateTime.now();
      _detailErrors.remove(ticket.id);
      _detailLoadingTicketIds.remove(ticketId);
      _detailRefreshingTicketIds.remove(ticketId);
      notifyListeners();
      unawaited(
        _signDetailAttachments(
          ticket.id,
          attachments.whereType<Map>().toList(),
          token,
        ),
      );
    } catch (error) {
      if (!retrying && _detailRequestTokens[ticketId] == token) {
        _detailLoadingTicketIds.remove(ticketId);
        _detailRefreshingTicketIds.remove(ticketId);
        await loadDetail(ticketId, force: true, retrying: true);
        return;
      }
      if (_detailRequestTokens[ticketId] == token) {
        _detailErrors[ticketId] = _friendlyError(error);
        _error = _friendlyError(error);
      }
    } finally {
      if (_detailRequestTokens[ticketId] == token) {
        _detailLoadingTicketIds.remove(ticketId);
        _detailRefreshingTicketIds.remove(ticketId);
      }
      notifyListeners();
    }
  }

  HospitalSlaSnapshot slaFor(HospitalTicket ticket) =>
      slaPolicy.snapshot(ticket, _now);

  Set<HospitalTicketAction> actionsFor(HospitalTicket ticket) {
    if (!productionMode) return accessPolicy.allowedActions(session, ticket);
    final actions = {...ticket.allowedActions};
    if (actions.contains(HospitalTicketAction.addProgress)) {
      actions
        ..add(HospitalTicketAction.addRemarks)
        ..add(HospitalTicketAction.uploadProgressPhoto);
    }
    if (actions.contains(HospitalTicketAction.resolve)) {
      actions.add(HospitalTicketAction.uploadCompletionPhoto);
    }
    return actions;
  }

  HospitalDashboardSummary get summary {
    final rows = visibleTickets;
    int count(HospitalTicketStatus status) =>
        rows.where((ticket) => ticket.status == status).length;
    return HospitalDashboardSummary(
      newComplaints: rows
          .where(
            (ticket) =>
                ticket.status ==
                    HospitalTicketStatus.awaitingSupervisorAcceptance ||
                (ticket.status == HospitalTicketStatus.open &&
                    _now.difference(ticket.raisedAt) <=
                        const Duration(minutes: 10)),
          )
          .length,
      awaitingAcceptance: rows
          .where(
            (ticket) =>
                ticket.status ==
                HospitalTicketStatus.awaitingSupervisorAcceptance,
          )
          .length,
      open: count(HospitalTicketStatus.open),
      assigned: count(HospitalTicketStatus.assigned),
      inProgress:
          count(HospitalTicketStatus.accepted) +
          count(HospitalTicketStatus.inProgress),
      dueSoon: rows
          .where(
            (ticket) => slaFor(ticket).state == HospitalSlaState.nearBreach,
          )
          .length,
      breached: rows
          .where((ticket) => slaFor(ticket).state == HospitalSlaState.breached)
          .length,
      nearBreach: rows
          .where(
            (ticket) => slaFor(ticket).state == HospitalSlaState.nearBreach,
          )
          .length,
      escalated:
          count(HospitalTicketStatus.escalatedOperationsExecutive) +
          count(HospitalTicketStatus.escalatedFacilityManager) +
          count(HospitalTicketStatus.escalatedProjectHead),
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
      unassigned: rows
          .where(
            (ticket) =>
                !ticket.isFinal &&
                ticket.responsiblePerson == 'Assignment pending',
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

  Future<void> accept(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.accept);
    if (productionMode) {
      return _remoteAction(ticket, 'accept', {'confirmed_location': true});
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
    return Future.value();
  }

  Future<void> startWork(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.startWork);
    if (productionMode) {
      return _remoteAction(ticket, 'start-work');
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
    return Future.value();
  }

  Future<void> addUpdate(
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
      return _remoteProgress(ticket, remarks.trim(), photoPath);
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
    return Future.value();
  }

  Future<void> resolve(
    String ticketId, {
    required String resolutionRemarks,
    String actionTaken = 'Work completed',
    String? completionPhotoPath,
  }) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.resolve);
    if (resolutionRemarks.trim().isEmpty) {
      throw ArgumentError('Work completion remarks are required.');
    }
    final photoPath = completionPhotoPath?.trim() ?? '';
    if (photoPath.isEmpty && ticket.completionPhotoPaths.isEmpty) {
      throw ArgumentError('A completion photo is required.');
    }
    if (productionMode) {
      return _remoteResolve(
        ticket,
        actionTaken.trim().isEmpty ? 'Work completed' : actionTaken.trim(),
        resolutionRemarks,
        photoPath.isEmpty ? null : photoPath,
      );
    }
    _replace(
      ticket.copyWith(
        status: HospitalTicketStatus.resolvedAwaitingConfirmation,
        resolvedAt: _now,
        actionTaken: actionTaken.trim(),
        resolutionRemarks: resolutionRemarks.trim(),
        completionPhotoPaths: photoPath.isEmpty
            ? ticket.completionPhotoPaths
            : [...ticket.completionPhotoPaths, photoPath],
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
    return Future.value();
  }

  Future<void> uploadCompletionPhoto(
    String ticketId, {
    required String photoPath,
  }) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.uploadCompletionPhoto);
    if (photoPath.trim().isEmpty) {
      throw ArgumentError('A completion photo is required.');
    }
    if (productionMode) {
      return _api
          .uploadPhoto(ticket.id, photoPath.trim(), 'completion_photo')
          .then((_) => loadDetail(ticket.id, force: true));
    }
    _replace(
      ticket.copyWith(
        completionPhotoPaths: [...ticket.completionPhotoPaths, photoPath],
        events: [
          ...ticket.events,
          _event(
            'Completion photo uploaded',
            'Completion evidence uploaded.',
            hasPhoto: true,
          ),
        ],
      ),
    );
    return Future.value();
  }

  Future<void> requestAssistance(String ticketId, String remarks) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.requestAssistance);
    if (productionMode) {
      return _remoteAction(ticket, 'request-assistance', {
        'remarks': remarks.trim(),
      });
    }
    return addUpdate(
      ticketId,
      remarks: remarks,
      action: 'Assistance requested',
    );
  }

  Future<void> takeOver(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.takeOver);
    if (productionMode) {
      return _remoteAction(ticket, 'take-over');
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
    return Future.value();
  }

  Future<void> reassignSupervisor(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.reassignSupervisor);
    if (productionMode) {
      return _remoteAction(ticket, 'reassign-supervisor', {
        'remarks': 'Reassigned to the block Housekeeping Supervisor.',
      });
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
    return Future.value();
  }

  Future<void> assignSupport(String ticketId, String remarks) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.assignSupport);
    if (productionMode) {
      return _remoteAction(ticket, 'assign-support', {
        'remarks': remarks.trim(),
      });
    }
    return addUpdate(ticketId, remarks: remarks, action: 'Support assigned');
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

  Future<void> escalateManually(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.escalateManually);
    if (productionMode) {
      return _remoteAction(ticket, 'escalate', {
        'remarks': 'Manually escalated for operational support.',
      });
    }
    _replace(
      slaPolicy.escalateSupervisorBreach(
        ticket,
        _now,
        reason: 'Manually escalated for immediate operational support.',
      ),
    );
    return Future.value();
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

  Future<void> escalateFurther(String ticketId) {
    final ticket = ticketById(ticketId);
    _requireAction(ticket, HospitalTicketAction.escalateFurther);
    if (productionMode) {
      return _remoteAction(ticket, 'escalate', {
        'remarks': 'Escalated for Facility Manager oversight.',
      });
    }
    _replace(
      slaPolicy.escalateOperationsBreach(
        ticket,
        _now,
        reason: 'Escalated further for Facility Manager oversight.',
      ),
    );
    return Future.value();
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
      supervisorDueAt: _now.add(
        slaPolicy.priorityWindow(HospitalPriority.high),
      ),
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
      if (ticket.status != HospitalTicketStatus.escalatedFacilityManager &&
          ticket.status != HospitalTicketStatus.escalatedProjectHead) {
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

  HospitalTicket? _findTicket(String id) {
    for (final ticket in _tickets) {
      if (ticket.id == id || ticket.ticketNumber == id) return ticket;
    }
    return null;
  }

  List<HospitalTicket> _mergeListRefresh(List<HospitalTicket> freshRows) {
    final previousById = {for (final ticket in _tickets) ticket.id: ticket};
    return freshRows.map((fresh) {
      final previous = previousById[fresh.id];
      if (previous == null) return fresh;
      return fresh.copyWith(
        complaintPhotoPaths: previous.complaintPhotoPaths,
        progressPhotoPaths: previous.progressPhotoPaths,
        completionPhotoPaths: previous.completionPhotoPaths,
        events: previous.events,
        allowedActions: previous.allowedActions,
      );
    }).toList();
  }

  Future<void> _signDetailAttachments(
    String ticketId,
    List<Map> attachments,
    int token,
  ) async {
    final complaintPhotos = <String>[];
    final progressPhotos = <String>[];
    final completionPhotos = <String>[];
    for (final attachment in attachments) {
      if (_detailRequestTokens[ticketId] != token) return;
      final attachmentId = '${attachment['id'] ?? ''}';
      if (attachmentId.isEmpty) continue;
      String? url = _signedAttachmentUrls[attachmentId];
      if (url == null || url.isEmpty) {
        try {
          url = await _api.signedDownload(ticketId, attachmentId);
          if (url.isNotEmpty) _signedAttachmentUrls[attachmentId] = url;
        } catch (_) {
          continue;
        }
      }
      if (url.isEmpty) continue;
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
    if (_detailRequestTokens[ticketId] != token) return;
    final current = _findTicket(ticketId);
    if (current == null) return;
    _replace(
      current.copyWith(
        complaintPhotoPaths: complaintPhotos.isEmpty
            ? current.complaintPhotoPaths
            : complaintPhotos,
        progressPhotoPaths: progressPhotos.isEmpty
            ? current.progressPhotoPaths
            : progressPhotos,
        completionPhotoPaths: completionPhotos.isEmpty
            ? current.completionPhotoPaths
            : completionPhotos,
      ),
    );
  }

  Future<void> _remoteAction(
    HospitalTicket ticket,
    String path, [
    Map<String, dynamic> payload = const {},
  ]) async {
    if (_busyTicketIds.contains(ticket.id)) return;
    _busyTicketIds.add(ticket.id);
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final response = await _api.action(
        ticket.id,
        path,
        ticket.version,
        payload,
      );
      final row = response['ticket'] is Map
          ? Map<String, dynamic>.from(response['ticket'] as Map)
          : null;
      if (row != null) {
        _replace(_mergeDetailTicket(row, response));
      }
      unawaited(loadDetail(ticket.id, force: true));
    } catch (error) {
      _error = _friendlyError(error);
      rethrow;
    } finally {
      _busyTicketIds.remove(ticket.id);
      _loading = false;
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
        await _api.uploadPhoto(ticket.id, photoPath, 'progress_photo');
      }
      await _remoteAction(ticket, 'progress', {'remarks': remarks});
    } catch (error) {
      _error = _friendlyError(error);
      notifyListeners();
      rethrow;
    }
  }

  HospitalTicket _mergeDetailTicket(
    Map<String, dynamic> row,
    Map<String, dynamic> response,
  ) {
    final previous = _findTicket('${row['id']}');
    final timeline = response['timeline'] is List
        ? response['timeline'] as List
        : const [];
    final allowedActions = response['allowed_actions'] is List
        ? (response['allowed_actions'] as List)
              .map((value) => hospitalActionFromCode('$value'))
              .whereType<HospitalTicketAction>()
              .toSet()
        : previous?.allowedActions ?? <HospitalTicketAction>{};
    return HospitalTicket.fromApi(row).copyWith(
      complaintPhotoPaths: previous?.complaintPhotoPaths,
      progressPhotoPaths: previous?.progressPhotoPaths,
      completionPhotoPaths: previous?.completionPhotoPaths,
      allowedActions: allowedActions,
      events: timeline.isEmpty
          ? previous?.events
          : timeline.whereType<Map>().map((event) {
              return HospitalTicketEvent(
                action: '${event['event_type'] ?? 'update'}'.replaceAll(
                  '_',
                  ' ',
                ),
                actor: '${event['actor_name'] ?? 'QPMS'}',
                actorRole: '${event['actor_role'] ?? 'system'}',
                occurredAt:
                    DateTime.tryParse(
                      '${event['created_at'] ?? ''}',
                    )?.toLocal() ??
                    DateTime.now(),
                remarks: '${event['remarks'] ?? ''}',
                hasPhoto: event['event_type'] == 'photo_uploaded',
              );
            }).toList(),
    );
  }

  String _friendlyError(Object error) {
    if (error is HospitalTicketApiException) return error.message;
    if (error is TimeoutException) return 'The request timed out. Try again.';
    return 'Unable to complete this action. Please try again.';
  }

  Future<void> _remoteResolve(
    HospitalTicket ticket,
    String actionTaken,
    String remarks,
    String? photoPath,
  ) async {
    try {
      if (photoPath != null && photoPath.trim().isNotEmpty) {
        await _api.uploadPhoto(ticket.id, photoPath.trim(), 'completion_photo');
      }
      await _remoteAction(ticket, 'resolve', {
        'resolution_action': actionTaken.trim(),
        'resolution_remarks': remarks.trim(),
      });
    } catch (error) {
      _error = _friendlyError(error);
      notifyListeners();
      rethrow;
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

  bool _matchesDashboardFilter(
    HospitalTicket ticket,
    HospitalTicketListFilter filter,
  ) {
    switch (filter) {
      case HospitalTicketListFilter.all:
        return true;
      case HospitalTicketListFilter.newAssignments:
      case HospitalTicketListFilter.awaitingAcceptance:
        return ticket.status ==
            HospitalTicketStatus.awaitingSupervisorAcceptance;
      case HospitalTicketListFilter.inProgress:
        return ticket.status == HospitalTicketStatus.accepted ||
            ticket.status == HospitalTicketStatus.inProgress;
      case HospitalTicketListFilter.dueSoon:
        return slaFor(ticket).state == HospitalSlaState.nearBreach;
      case HospitalTicketListFilter.breached:
        return slaFor(ticket).state == HospitalSlaState.breached;
      case HospitalTicketListFilter.escalated:
        return ticket.status ==
                HospitalTicketStatus.escalatedOperationsExecutive ||
            ticket.status == HospitalTicketStatus.escalatedFacilityManager ||
            ticket.status == HospitalTicketStatus.escalatedProjectHead;
      case HospitalTicketListFilter.reopened:
        return ticket.status == HospitalTicketStatus.reopened;
      case HospitalTicketListFilter.resolvedToday:
        return ticket.status == HospitalTicketStatus.closed &&
            ticket.events.any(
              (event) =>
                  event.action == 'Final closure' &&
                  _sameDate(event.occurredAt, _now),
            );
      case HospitalTicketListFilter.unassigned:
        return !ticket.isFinal &&
            ticket.responsiblePerson == 'Assignment pending';
    }
  }

  static bool _sameDate(DateTime left, DateTime right) =>
      left.year == right.year &&
      left.month == right.month &&
      left.day == right.day;
}
