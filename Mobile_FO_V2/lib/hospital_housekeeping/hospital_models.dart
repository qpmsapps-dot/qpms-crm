enum HospitalDemoRole { supervisor, operationsExecutive, facilityManager }

enum HospitalTicketStatus {
  open,
  assigned,
  accepted,
  inProgress,
  escalatedOperationsExecutive,
  escalatedFacilityManager,
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
    this.userId = '',
    this.isDemo = true,
  });

  final String loginId;
  final String displayName;
  final HospitalDemoRole role;
  final String? assignedBlock;
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
  final String block;
  final String floor;
  final String location;
  final String category;
  final HospitalPriority priority;
  final String description;
  final String reportedBy;
  final DateTime raisedAt;
  final HospitalTicketStatus status;
  final String responsiblePerson;
  final String responsibleRole;
  final String supervisorName;
  final DateTime supervisorDueAt;
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

  bool get isFinal =>
      status == HospitalTicketStatus.closed ||
      status == HospitalTicketStatus.cancelled;

  bool get isAwaitingClient =>
      status == HospitalTicketStatus.resolvedAwaitingConfirmation;

  HospitalTicket copyWith({
    HospitalTicketStatus? status,
    String? responsiblePerson,
    String? responsibleRole,
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
  }) {
    return HospitalTicket(
      id: id,
      block: block,
      floor: floor,
      location: location,
      category: category,
      priority: priority,
      description: description,
      reportedBy: reportedBy,
      raisedAt: raisedAt,
      status: status ?? this.status,
      responsiblePerson: responsiblePerson ?? this.responsiblePerson,
      responsibleRole: responsibleRole ?? this.responsibleRole,
      supervisorName: supervisorName,
      supervisorDueAt: supervisorDueAt,
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
    );
  }

  factory HospitalTicket.fromApi(Map<String, dynamic> row) {
    final block = row['block'] is Map ? row['block'] as Map : const {};
    final location = row['location'] is Map ? row['location'] as Map : const {};
    final category = row['category'] is Map ? row['category'] as Map : const {};
    final assignee = row['assignee'] is Map ? row['assignee'] as Map : const {};
    return HospitalTicket(
      id: '${row['id'] ?? ''}',
      block: '${block['block_name'] ?? ''}',
      floor: '${row['floor_name'] ?? location['floor_name'] ?? ''}',
      location: '${row['location_text'] ?? location['location_name'] ?? ''}',
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
      status: _hospitalStatusFromCode('${row['status_code'] ?? 'open'}'),
      responsiblePerson: '${assignee['display_name'] ?? 'Assignment pending'}',
      responsibleRole: '${row['current_assignee_role'] ?? ''}',
      supervisorName: 'Assigned Housekeeping Supervisor',
      supervisorDueAt:
          DateTime.tryParse(
            '${row['supervisor_sla_due_at'] ?? ''}',
          )?.toLocal() ??
          DateTime.now(),
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
      events: const [],
    );
  }
}

HospitalTicketStatus _hospitalStatusFromCode(String value) => switch (value) {
  'assigned' => HospitalTicketStatus.assigned,
  'accepted' => HospitalTicketStatus.accepted,
  'in_progress' => HospitalTicketStatus.inProgress,
  'escalated_operations_executive' =>
    HospitalTicketStatus.escalatedOperationsExecutive,
  'escalated_facility_manager' => HospitalTicketStatus.escalatedFacilityManager,
  'resolved_awaiting_confirmation' =>
    HospitalTicketStatus.resolvedAwaitingConfirmation,
  'reopened' => HospitalTicketStatus.reopened,
  'closed' => HospitalTicketStatus.closed,
  'cancelled' => HospitalTicketStatus.cancelled,
  _ => HospitalTicketStatus.open,
};

extension HospitalDemoRoleLabels on HospitalDemoRole {
  String get label => switch (this) {
    HospitalDemoRole.supervisor => 'Housekeeping Supervisor',
    HospitalDemoRole.operationsExecutive => 'Operations Executive',
    HospitalDemoRole.facilityManager => 'Facility Manager',
  };
}

extension HospitalStatusLabels on HospitalTicketStatus {
  String get code => switch (this) {
    HospitalTicketStatus.open => 'open',
    HospitalTicketStatus.assigned => 'assigned',
    HospitalTicketStatus.accepted => 'accepted',
    HospitalTicketStatus.inProgress => 'in_progress',
    HospitalTicketStatus.escalatedOperationsExecutive =>
      'escalated_operations_executive',
    HospitalTicketStatus.escalatedFacilityManager =>
      'escalated_facility_manager',
    HospitalTicketStatus.resolvedAwaitingConfirmation =>
      'resolved_awaiting_confirmation',
    HospitalTicketStatus.reopened => 'reopened',
    HospitalTicketStatus.closed => 'closed',
    HospitalTicketStatus.cancelled => 'cancelled',
  };

  String get label => switch (this) {
    HospitalTicketStatus.open => 'Open',
    HospitalTicketStatus.assigned => 'Assigned',
    HospitalTicketStatus.accepted => 'Accepted',
    HospitalTicketStatus.inProgress => 'In Progress',
    HospitalTicketStatus.escalatedOperationsExecutive =>
      'Escalated to Operations Executive',
    HospitalTicketStatus.escalatedFacilityManager =>
      'Escalated to Facility Manager',
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
