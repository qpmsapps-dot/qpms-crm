import 'ticket_update.dart';

enum TicketStatus {
  open,
  assigned,
  accepted,
  inProgress,
  escalatedOperations,
  escalatedFacilityManager,
  awaitingConfirmation,
  reopened,
  closed,
  cancelled,
}

enum TicketPriority { low, medium, high }

enum TicketListFilter {
  all,
  open,
  assigned,
  inProgress,
  awaitingConfirmation,
  resolved,
  closed,
  reopened,
}

class Ticket {
  const Ticket({
    this.id = '',
    this.version = 1,
    required this.number,
    required this.block,
    required this.floor,
    required this.location,
    this.site = '',
    this.department = '',
    this.ward = '',
    this.roomArea = '',
    this.exactLandmark = '',
    this.completeLocationPath = '',
    required this.category,
    required this.description,
    required this.priority,
    required this.raisedBy,
    required this.raisedAt,
    required this.status,
    required this.assignedPerson,
    required this.assignedRole,
    required this.slaLabel,
    this.complaintPhotoAssets = const [],
    this.completionPhotoAssets = const [],
    this.resolutionNotes = '',
    this.updates = const [],
    this.feedbackRating,
    this.feedbackComment = '',
    this.isSatisfied,
  });

  final String id;
  final int version;

  final String number;
  final String block;
  final String floor;
  final String location;
  final String site;
  final String department;
  final String ward;
  final String roomArea;
  final String exactLandmark;
  final String completeLocationPath;
  final String category;
  final String description;
  final TicketPriority priority;
  final String raisedBy;
  final DateTime raisedAt;
  final TicketStatus status;
  final String assignedPerson;
  final String assignedRole;
  final String slaLabel;
  final List<String> complaintPhotoAssets;
  final List<String> completionPhotoAssets;
  final String resolutionNotes;
  final List<TicketUpdate> updates;
  final int? feedbackRating;
  final String feedbackComment;
  final bool? isSatisfied;

  factory Ticket.fromApi(
    Map<String, dynamic> row, {
    List<TicketUpdate> updates = const [],
  }) {
    final block = row['block'] is Map ? row['block'] as Map : const {};
    final location = row['location'] is Map ? row['location'] as Map : const {};
    final category = row['category'] is Map ? row['category'] as Map : const {};
    final assignee = row['assignee'] is Map ? row['assignee'] as Map : const {};
    final roomArea = _firstText([
      row['room_area_snapshot'],
      location['room_number'],
      location['area_name'],
    ]);
    return Ticket(
      id: '${row['id'] ?? ''}',
      version: int.tryParse('${row['version'] ?? 1}') ?? 1,
      number: '${row['ticket_no'] ?? ''}',
      site: '${row['site_name_snapshot'] ?? ''}',
      block: _firstText([row['block_name_snapshot'], block['block_name']]),
      floor: _firstText([
        row['floor_name_snapshot'],
        row['floor_name'],
        location['floor_name'],
      ]),
      department: _firstText([
        row['department_name_snapshot'],
        row['department_name'],
        location['department_name'],
      ]),
      ward: '${row['ward_name_snapshot'] ?? ''}',
      roomArea: roomArea,
      exactLandmark: '${row['exact_landmark_snapshot'] ?? ''}',
      completeLocationPath: '${row['location_path_snapshot'] ?? ''}',
      location: _firstText([
        row['location_text'],
        location['location_name'],
        roomArea,
      ]),
      category: '${category['category_name'] ?? ''}',
      description: '${row['description'] ?? ''}',
      priority: _priorityFromCode('${row['priority'] ?? 'medium'}'),
      raisedBy: '${row['raised_by_name'] ?? ''}',
      raisedAt:
          DateTime.tryParse('${row['raised_at'] ?? ''}')?.toLocal() ??
          DateTime.now(),
      status: _statusFromCode('${row['status_code'] ?? 'open'}'),
      assignedPerson: '${assignee['display_name'] ?? 'Assignment pending'}',
      assignedRole: '${row['current_assignee_role'] ?? ''}',
      slaLabel: row['assignment_state'] == 'unassigned'
          ? 'Assignment pending • Supervisor SLA not started'
          : '${row['sla_label'] ?? 'SLA managed by QPMS'}',
      resolutionNotes: '${row['resolution_remarks'] ?? ''}',
      feedbackRating: row['client_rating'] as int?,
      feedbackComment: '${row['client_feedback'] ?? ''}',
      isSatisfied: row['client_satisfaction_status'] == null
          ? null
          : row['client_satisfaction_status'] == 'satisfied',
      updates: updates,
    );
  }

  String get fullLocation => _joinLocation([block, floor, location]);
  String get conciseLocation =>
      _joinLocation([block, floor, roomArea.isNotEmpty ? roomArea : location]);
  String get detailLocation => completeLocationPath.isNotEmpty
      ? completeLocationPath
      : _joinLocation([
          site,
          block,
          floor,
          department,
          ward,
          roomArea,
          location,
          exactLandmark,
        ]);

  Ticket copyWith({
    TicketStatus? status,
    String? assignedPerson,
    String? assignedRole,
    String? slaLabel,
    List<String>? complaintPhotoAssets,
    List<String>? completionPhotoAssets,
    String? resolutionNotes,
    List<TicketUpdate>? updates,
    int? feedbackRating,
    String? feedbackComment,
    bool? isSatisfied,
  }) {
    return Ticket(
      id: id,
      version: version,
      number: number,
      block: block,
      floor: floor,
      location: location,
      site: site,
      department: department,
      ward: ward,
      roomArea: roomArea,
      exactLandmark: exactLandmark,
      completeLocationPath: completeLocationPath,
      category: category,
      description: description,
      priority: priority,
      raisedBy: raisedBy,
      raisedAt: raisedAt,
      status: status ?? this.status,
      assignedPerson: assignedPerson ?? this.assignedPerson,
      assignedRole: assignedRole ?? this.assignedRole,
      slaLabel: slaLabel ?? this.slaLabel,
      complaintPhotoAssets: complaintPhotoAssets ?? this.complaintPhotoAssets,
      completionPhotoAssets:
          completionPhotoAssets ?? this.completionPhotoAssets,
      resolutionNotes: resolutionNotes ?? this.resolutionNotes,
      updates: updates ?? this.updates,
      feedbackRating: feedbackRating ?? this.feedbackRating,
      feedbackComment: feedbackComment ?? this.feedbackComment,
      isSatisfied: isSatisfied ?? this.isSatisfied,
    );
  }
}

String statusLabel(TicketStatus status) => switch (status) {
  TicketStatus.open => 'Open',
  TicketStatus.assigned => 'Assigned',
  TicketStatus.accepted => 'Accepted',
  TicketStatus.inProgress => 'In Progress',
  TicketStatus.escalatedOperations => 'Escalated to Operations',
  TicketStatus.escalatedFacilityManager => 'Escalated to Facility Manager',
  TicketStatus.awaitingConfirmation => 'Resolved – Awaiting Confirmation',
  TicketStatus.reopened => 'Reopened',
  TicketStatus.closed => 'Closed',
  TicketStatus.cancelled => 'Cancelled',
};

String shortStatusLabel(TicketStatus status) => switch (status) {
  TicketStatus.escalatedOperations => 'Ops Escalation',
  TicketStatus.escalatedFacilityManager => 'FM Escalation',
  TicketStatus.awaitingConfirmation => 'Awaiting Confirmation',
  _ => statusLabel(status),
};

String priorityLabel(TicketPriority priority) => switch (priority) {
  TicketPriority.low => 'Low',
  TicketPriority.medium => 'Medium',
  TicketPriority.high => 'High',
};

bool ticketMatchesFilter(Ticket ticket, TicketListFilter filter) {
  return switch (filter) {
    TicketListFilter.all => true,
    TicketListFilter.open => ticket.status == TicketStatus.open,
    TicketListFilter.assigned => ticket.status == TicketStatus.assigned,
    TicketListFilter.inProgress =>
      ticket.status == TicketStatus.accepted ||
          ticket.status == TicketStatus.inProgress,
    TicketListFilter.awaitingConfirmation =>
      ticket.status == TicketStatus.awaitingConfirmation,
    TicketListFilter.resolved =>
      ticket.status == TicketStatus.awaitingConfirmation,
    TicketListFilter.closed => ticket.status == TicketStatus.closed,
    TicketListFilter.reopened => ticket.status == TicketStatus.reopened,
  };
}

TicketStatus _statusFromCode(String value) => switch (value) {
  'assigned' => TicketStatus.assigned,
  'accepted' => TicketStatus.accepted,
  'in_progress' => TicketStatus.inProgress,
  'escalated_operations_executive' => TicketStatus.escalatedOperations,
  'escalated_facility_manager' => TicketStatus.escalatedFacilityManager,
  'resolved_awaiting_confirmation' => TicketStatus.awaitingConfirmation,
  'reopened' => TicketStatus.reopened,
  'closed' => TicketStatus.closed,
  'cancelled' => TicketStatus.cancelled,
  _ => TicketStatus.open,
};

TicketPriority _priorityFromCode(String value) => switch (value) {
  'high' || 'critical' => TicketPriority.high,
  'low' => TicketPriority.low,
  _ => TicketPriority.medium,
};

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

String _joinLocation(List<String> values) {
  final seen = <String>{};
  return values
      .map((value) => value.trim())
      .where((value) => value.isNotEmpty)
      .where((value) => !_isMissingLocationPlaceholder(value))
      .where((value) => seen.add(value.toLowerCase()))
      .join(' • ');
}

bool _isMissingLocationPlaceholder(String value) {
  final key = value.trim().toLowerCase();
  return key == 'not specified' || key == 'floor not confirmed';
}

String formatTicketDateTime(DateTime value) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  final hour = value.hour == 0
      ? 12
      : (value.hour > 12 ? value.hour - 12 : value.hour);
  final minute = value.minute.toString().padLeft(2, '0');
  final period = value.hour >= 12 ? 'PM' : 'AM';
  return '${value.day} ${months[value.month - 1]} ${value.year}, '
      '${hour.toString().padLeft(2, '0')}:$minute $period';
}
