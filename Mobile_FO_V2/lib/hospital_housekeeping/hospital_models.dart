enum HospitalDemoRole { supervisor, operationsExecutive, facilityManager, projectHead }

enum HospitalTicketStatus {
  open,
  awaitingSupervisorAcceptance,
  assigned,
  accepted,
  inProgress,
  escalatedOperationsExecutive,
  escalatedFacilityManager,
  escalatedProjectHead,
  resolvedAwaitingConfirmation,
  reopened,
  closed,
  cancelled,
}

enum HospitalPriority { low, medium, high }

enum HospitalTicketAction {
  accept,
  startWork,
  addProgress,
  addRemarks,
  uploadProgressPhoto,
  resolve,
  requestAssistance,
  escalateManually,
  takeOver,
  reassignSupervisor,
  escalateFurther,
  assignSupport,
  simulateSupervisorBreach,
  simulateOperationsBreach,
  simulateClientSatisfied,
  simulateClientNotSatisfied,
}

class HospitalDemoSession {
  const HospitalDemoSession({
    required this.loginId,
    required this.displayName,
    required this.role,
    this.assignedBlock,
    this.userCode = '',
    this.email = '',
    this.mobile = '',
    this.clientName = '',
    this.userId = '',
    this.isDemo = true,
  });

  final String loginId;
  final String displayName;
  final HospitalDemoRole role;
  final String? assignedBlock;
  final String userCode;
  final String email;
  final String mobile;
  final String clientName;
  final String userId;
  final bool isDemo;

  bool get hasAllBlocks => role != HospitalDemoRole.supervisor;
}

class HospitalTicketEvent {
  const HospitalTicketEvent({
    required this.action,
    required this.actor,
    required this.actorRole,
    required this.occurredAt,
    required this.remarks,
    this.hasPhoto = false,
  });

  final String action;
  final String actor;
  final String actorRole;
  final DateTime occurredAt;
  final String remarks;
  final bool hasPhoto;
}

class HospitalTicket {
  const HospitalTicket({
    required this.id,
    this.ticketNumber = '',
    required this.block,
    required this.floor,
    required this.location,
    required this.category,
    required this.priority,
    required this.description,
    required this.reportedBy,
    required this.raisedAt,
    required this.status,
    required this.responsiblePerson,
    required this.responsibleRole,
    required this.supervisorName,
    required this.supervisorDueAt,
    required this.events,
    this.escalationDueAt,
    this.acceptanceDueAt,
    this.acceptanceStatus = '',
    this.acceptedByName = '',
    this.site = '',
    this.department = '',
    this.ward = '',
    this.roomArea = '',
    this.exactLandmark = '',
    this.completeLocationPath = '',
    this.locationType = '',
    this.assignedAt,
    this.acceptedAt,
    this.workStartedAt,
    this.allowedActions = const {},
    this.complaintPhotoPaths = const [],
    this.progressPhotoPaths = const [],
    this.completionPhotoPaths = const [],
    this.operationsEscalatedAt,
    this.operationsDueAt,
    this.facilityEscalatedAt,
    this.resolvedAt,
    this.resolutionRemarks = '',
    this.actionTaken = '',
    this.clientRating,
    this.clientFeedback = '',
    this.clientSatisfied,
    this.reopenedCount = 0,
    this.version = 1,
  });

  final String id;
  final String ticketNumber;
  final String site;
  final String block;
  final String floor;
  final String department;
  final String location;
  final String ward;
  final String roomArea;
  final String exactLandmark;
  final String completeLocationPath;
  final String locationType;
  final String category;
  final HospitalPriority priority;
  final String description;
  final String reportedBy;
  final DateTime raisedAt;
  final DateTime? assignedAt;
  final DateTime? acceptedAt;
  final DateTime? workStartedAt;
  final HospitalTicketStatus status;
  final String responsiblePerson;
  final String responsibleRole;
  final String supervisorName;
  final DateTime? supervisorDueAt;
  final DateTime? escalationDueAt;
  final DateTime? acceptanceDueAt;
  final String acceptanceStatus;
  final String acceptedByName;
  final DateTime? operationsEscalatedAt;
  final DateTime? operationsDueAt;
  final DateTime? facilityEscalatedAt;
  final DateTime? resolvedAt;
  final String resolutionRemarks;
  final String actionTaken;
  final List<String> complaintPhotoPaths;
  final List<String> progressPhotoPaths;
  final List<String> completionPhotoPaths;
  final List<HospitalTicketEvent> events;
  final int? clientRating;
  final String clientFeedback;
  final bool? clientSatisfied;
  final int reopenedCount;
  final int version;
  final Set<HospitalTicketAction> allowedActions;

  bool get isFinal =>
      status == HospitalTicketStatus.closed ||
      status == HospitalTicketStatus.cancelled;

  bool get isAwaitingClient =>
      status == HospitalTicketStatus.resolvedAwaitingConfirmation;

  HospitalTicket copyWith({
    HospitalTicketStatus? status,
    String? responsiblePerson,
    String? responsibleRole,
    DateTime? assignedAt,
    DateTime? acceptedAt,
    DateTime? workStartedAt,
    DateTime? supervisorDueAt,
    DateTime? escalationDueAt,
    DateTime? acceptanceDueAt,
    String? acceptanceStatus,
    String? acceptedByName,
    DateTime? operationsEscalatedAt,
    DateTime? operationsDueAt,
    DateTime? facilityEscalatedAt,
    DateTime? resolvedAt,
    String? resolutionRemarks,
    String? actionTaken,
    List<String>? complaintPhotoPaths,
    List<String>? progressPhotoPaths,
    List<String>? completionPhotoPaths,
    List<HospitalTicketEvent>? events,
    int? clientRating,
    String? clientFeedback,
    bool? clientSatisfied,
    int? reopenedCount,
    int? version,
    Set<HospitalTicketAction>? allowedActions,
  }) {
    return HospitalTicket(
      id: id,
      ticketNumber: ticketNumber,
      site: site,
      block: block,
      floor: floor,
      department: department,
      location: location,
      ward: ward,
      roomArea: roomArea,
      exactLandmark: exactLandmark,
      completeLocationPath: completeLocationPath,
      locationType: locationType,
      category: category,
      priority: priority,
      description: description,
      reportedBy: reportedBy,
      raisedAt: raisedAt,
      assignedAt: assignedAt ?? this.assignedAt,
      acceptedAt: acceptedAt ?? this.acceptedAt,
      workStartedAt: workStartedAt ?? this.workStartedAt,
      status: status ?? this.status,
      responsiblePerson: responsiblePerson ?? this.responsiblePerson,
      responsibleRole: responsibleRole ?? this.responsibleRole,
      supervisorName: supervisorName,
      supervisorDueAt: supervisorDueAt ?? this.supervisorDueAt,
      escalationDueAt: escalationDueAt ?? this.escalationDueAt,
      acceptanceDueAt: acceptanceDueAt ?? this.acceptanceDueAt,
      acceptanceStatus: acceptanceStatus ?? this.acceptanceStatus,
      acceptedByName: acceptedByName ?? this.acceptedByName,
      operationsEscalatedAt:
          operationsEscalatedAt ?? this.operationsEscalatedAt,
      operationsDueAt: operationsDueAt ?? this.operationsDueAt,
      facilityEscalatedAt: facilityEscalatedAt ?? this.facilityEscalatedAt,
      resolvedAt: resolvedAt ?? this.resolvedAt,
      resolutionRemarks: resolutionRemarks ?? this.resolutionRemarks,
      actionTaken: actionTaken ?? this.actionTaken,
      complaintPhotoPaths: complaintPhotoPaths ?? this.complaintPhotoPaths,
      progressPhotoPaths: progressPhotoPaths ?? this.progressPhotoPaths,
      completionPhotoPaths: completionPhotoPaths ?? this.completionPhotoPaths,
      events: events ?? this.events,
      clientRating: clientRating ?? this.clientRating,
      clientFeedback: clientFeedback ?? this.clientFeedback,
      clientSatisfied: clientSatisfied ?? this.clientSatisfied,
      reopenedCount: reopenedCount ?? this.reopenedCount,
      version: version ?? this.version,
      allowedActions: allowedActions ?? this.allowedActions,
    );
  }

  factory HospitalTicket.fromApi(Map<String, dynamic> row) {
    final block = row['block'] is Map ? row['block'] as Map : const {};
    final location = row['location'] is Map ? row['location'] as Map : const {};
    final category = row['category'] is Map ? row['category'] as Map : const {};
    final assignee = row['assignee'] is Map ? row['assignee'] as Map : const {};
    final acceptedBy = row['accepted_by'] is Map ? row['accepted_by'] as Map : const {};
    final floorName = _firstText([
      row['floor_name_snapshot'],
      row['floor_name'],
      location['floor_name'],
    ]);
    final departmentName = _firstText([
      row['department_name_snapshot'],
      row['department_name'],
      location['department_name'],
    ]);
    final roomArea = _firstText([
      row['room_area_snapshot'],
      location['room_number'],
      location['area_name'],
    ]);
    final locationText = _firstText([
      row['location_text'],
      location['location_name'],
    ]);
    final exactLandmark = _firstText([row['exact_landmark_snapshot']]);
    final locationPath = _firstText([
      row['location_path_snapshot'],
      row['complete_location_path'],
    ]);
    final allowed = row['allowed_actions'] is List
        ? (row['allowed_actions'] as List)
              .map((value) => hospitalActionFromCode('$value'))
              .whereType<HospitalTicketAction>()
              .toSet()
        : <HospitalTicketAction>{};
    return HospitalTicket(
      id: '${row['id'] ?? ''}',
      ticketNumber: _firstText([row['ticket_no'], row['ticket_number']]),
      site: _firstText([row['site_name_snapshot'], row['client_name']]),
      block: _firstText([row['block_name_snapshot'], block['block_name']]),
      floor: floorName,
      department: departmentName,
      location: locationText,
      ward: _firstText([row['ward_name_snapshot'], location['ward_name']]),
      roomArea: roomArea,
      exactLandmark: exactLandmark,
      completeLocationPath: locationPath,
      locationType: _firstText([location['location_type']]),
      category: '${category['category_name'] ?? ''}',
      priority: switch ('${row['priority'] ?? 'medium'}') {
        'critical' || 'high' => HospitalPriority.high,
        'low' => HospitalPriority.low,
        _ => HospitalPriority.medium,
      },
      description: '${row['description'] ?? ''}',
      reportedBy: '${row['raised_by_name'] ?? ''}',
      raisedAt:
          DateTime.tryParse('${row['raised_at'] ?? ''}')?.toLocal() ??
          DateTime.now(),
      assignedAt: DateTime.tryParse('${row['assigned_at'] ?? ''}')?.toLocal(),
      acceptedAt: DateTime.tryParse('${row['accepted_at'] ?? ''}')?.toLocal(),
      workStartedAt: DateTime.tryParse(
        '${row['work_started_at'] ?? ''}',
      )?.toLocal(),
      status: _hospitalStatusFromCode('${row['status_code'] ?? 'open'}'),
      responsiblePerson: '${assignee['display_name'] ?? 'Assignment pending'}',
      responsibleRole: '${row['current_assignee_role'] ?? ''}',
      supervisorName: _firstText([
        row['supervisor_name'],
        assignee['role_code'] == 'housekeeping_supervisor'
            ? assignee['display_name']
            : '',
        'Assigned Housekeeping Supervisor',
      ]),
      supervisorDueAt: DateTime.tryParse(
        '${row['supervisor_sla_due_at'] ?? ''}',
      )?.toLocal(),
      escalationDueAt: DateTime.tryParse(
        '${row['escalation_due_at'] ?? ''}',
      )?.toLocal(),
      acceptanceDueAt: DateTime.tryParse(
        '${row['acceptance_due_at'] ?? ''}',
      )?.toLocal(),
      acceptanceStatus: '${row['acceptance_status'] ?? ''}',
      acceptedByName: '${acceptedBy['display_name'] ?? ''}',
      operationsEscalatedAt: DateTime.tryParse(
        '${row['supervisor_escalated_at'] ?? ''}',
      )?.toLocal(),
      operationsDueAt: DateTime.tryParse(
        '${row['operations_sla_due_at'] ?? ''}',
      )?.toLocal(),
      facilityEscalatedAt: DateTime.tryParse(
        '${row['operations_escalated_at'] ?? ''}',
      )?.toLocal(),
      resolvedAt: DateTime.tryParse('${row['resolved_at'] ?? ''}')?.toLocal(),
      resolutionRemarks: '${row['resolution_remarks'] ?? ''}',
      actionTaken: '${row['resolution_action'] ?? ''}',
      clientRating: row['client_rating'] as int?,
      clientFeedback: '${row['client_feedback'] ?? ''}',
      clientSatisfied: row['client_satisfaction_status'] == null
          ? null
          : row['client_satisfaction_status'] == 'satisfied',
      reopenedCount: int.tryParse('${row['reopen_count'] ?? 0}') ?? 0,
      version: int.tryParse('${row['version'] ?? 1}') ?? 1,
      allowedActions: allowed,
      events: const [],
    );
  }

  List<String> get locationParts => _dedupe([
    site,
    block,
    floor,
    department,
    ward,
    roomArea,
    _locationWithoutDuplicateRoom,
    exactLandmark,
  ]);

  String get fullLocationDisplay {
    if (completeLocationPath.trim().isNotEmpty) {
      return _dedupe(
        completeLocationPath
            .split(RegExp(r'\s*(?:>|•)\s*'))
            .map((part) => part.trim())
            .toList(),
      ).join('\n');
    }
    return locationParts.join('\n');
  }

  String get conciseLocation {
    final parts = _dedupe([
      block,
      floor,
      department,
      roomArea,
      _locationWithoutDuplicateRoom,
      exactLandmark,
    ]);
    return parts.take(4).join(' • ');
  }

  String get _locationWithoutDuplicateRoom {
    final key = location.trim().toLowerCase();
    if (key.isEmpty || key == roomArea.trim().toLowerCase()) return '';
    if (key == exactLandmark.trim().toLowerCase()) return '';
    return location;
  }
}

String _firstText(List<dynamic> values) {
  for (final value in values) {
    final text = '${value ?? ''}'.trim();
    if (text.isNotEmpty &&
        text != 'null' &&
        !_isMissingLocationPlaceholder(text)) {
      return text;
    }
  }
  return '';
}

List<String> _dedupe(List<String> values) {
  final seen = <String>{};
  return values
      .map((value) => value.trim())
      .where((value) => value.isNotEmpty)
      .where((value) => !_isMissingLocationPlaceholder(value))
      .where((value) => seen.add(value.toLowerCase()))
      .toList();
}

bool _isMissingLocationPlaceholder(String value) {
  final key = value.trim().toLowerCase();
  return key == 'not specified' ||
      key == 'floor not confirmed' ||
      key == 'unknown room';
}

HospitalTicketStatus _hospitalStatusFromCode(String value) => switch (value) {
  'awaiting_supervisor_acceptance' =>
    HospitalTicketStatus.awaitingSupervisorAcceptance,
  'assigned' => HospitalTicketStatus.assigned,
  'accepted' => HospitalTicketStatus.accepted,
  'in_progress' => HospitalTicketStatus.inProgress,
  'escalated_operations_executive' =>
    HospitalTicketStatus.escalatedOperationsExecutive,
  'escalated_facility_manager' => HospitalTicketStatus.escalatedFacilityManager,
  'escalated_project_head' => HospitalTicketStatus.escalatedProjectHead,
  'resolved_awaiting_confirmation' =>
    HospitalTicketStatus.resolvedAwaitingConfirmation,
  'reopened' => HospitalTicketStatus.reopened,
  'closed' => HospitalTicketStatus.closed,
  'cancelled' => HospitalTicketStatus.cancelled,
  _ => HospitalTicketStatus.open,
};

HospitalTicketAction? hospitalActionFromCode(String value) => switch (value) {
  'accept' => HospitalTicketAction.accept,
  'start_work' => HospitalTicketAction.startWork,
  'progress' => HospitalTicketAction.addProgress,
  'request_assistance' => HospitalTicketAction.requestAssistance,
  'manual_escalation' => HospitalTicketAction.escalateManually,
  'take_over' => HospitalTicketAction.takeOver,
  'reassign_supervisor' => HospitalTicketAction.reassignSupervisor,
  'assign_support' => HospitalTicketAction.assignSupport,
  'resolve' => HospitalTicketAction.resolve,
  _ => null,
};

extension HospitalDemoRoleLabels on HospitalDemoRole {
  String get label => switch (this) {
    HospitalDemoRole.supervisor => 'Housekeeping Supervisor',
    HospitalDemoRole.operationsExecutive => 'Operations Executive',
    HospitalDemoRole.facilityManager => 'Facility Manager',
    HospitalDemoRole.projectHead => 'Project Head',
  };
}

extension HospitalStatusLabels on HospitalTicketStatus {
  String get code => switch (this) {
    HospitalTicketStatus.open => 'open',
    HospitalTicketStatus.awaitingSupervisorAcceptance =>
      'awaiting_supervisor_acceptance',
    HospitalTicketStatus.assigned => 'assigned',
    HospitalTicketStatus.accepted => 'accepted',
    HospitalTicketStatus.inProgress => 'in_progress',
    HospitalTicketStatus.escalatedOperationsExecutive =>
      'escalated_operations_executive',
    HospitalTicketStatus.escalatedFacilityManager =>
      'escalated_facility_manager',
    HospitalTicketStatus.escalatedProjectHead => 'escalated_project_head',
    HospitalTicketStatus.resolvedAwaitingConfirmation =>
      'resolved_awaiting_confirmation',
    HospitalTicketStatus.reopened => 'reopened',
    HospitalTicketStatus.closed => 'closed',
    HospitalTicketStatus.cancelled => 'cancelled',
  };

  String get label => switch (this) {
    HospitalTicketStatus.open => 'Open',
    HospitalTicketStatus.awaitingSupervisorAcceptance =>
      'Waiting for QPMS response',
    HospitalTicketStatus.assigned => 'Assigned',
    HospitalTicketStatus.accepted => 'Accepted',
    HospitalTicketStatus.inProgress => 'In Progress',
    HospitalTicketStatus.escalatedOperationsExecutive =>
      'Escalated to Operations Executive',
    HospitalTicketStatus.escalatedFacilityManager =>
      'Escalated to Facility Manager',
    HospitalTicketStatus.escalatedProjectHead => 'Escalated to Project Head',
    HospitalTicketStatus.resolvedAwaitingConfirmation =>
      'Resolved - Awaiting Client Confirmation',
    HospitalTicketStatus.reopened => 'Reopened',
    HospitalTicketStatus.closed => 'Closed',
    HospitalTicketStatus.cancelled => 'Cancelled',
  };
}

extension HospitalPriorityLabels on HospitalPriority {
  String get label => switch (this) {
    HospitalPriority.low => 'Low',
    HospitalPriority.medium => 'Medium',
    HospitalPriority.high => 'High',
  };
}
