import 'training_attendee.dart';
import 'training_category.dart';
import 'training_evidence.dart';
import 'training_session_topic.dart';
import 'training_type.dart';

enum TrainingSessionStatus { draft, submitted, cancelled, unknown }

extension TrainingSessionStatusValue on TrainingSessionStatus {
  String get wireValue => name;
  static TrainingSessionStatus parse(dynamic value) =>
      TrainingSessionStatus.values.firstWhere(
        (item) =>
            item != TrainingSessionStatus.unknown && item.name == '$value',
        orElse: () => TrainingSessionStatus.unknown,
      );
}

DateTime? _date(dynamic value) =>
    value == null ? null : DateTime.tryParse('$value');
Map<String, dynamic>? _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : null;
List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList()
    : const [];

class TrainingSession {
  const TrainingSession({
    required this.id,
    required this.status,
    this.trainingDate,
    this.category,
    this.trainingType,
    this.trainerName,
    this.remarks,
    this.attendanceId,
    this.siteVisitId,
    this.storeId,
    this.accessClientCode,
    this.businessNameSnapshot,
    this.stateSnapshot,
    this.storeCodeSnapshot,
    this.storeNameSnapshot,
    this.requireAttendeeSnapshot = true,
    this.requireSelectedTopicSnapshot = true,
    this.topicEvidencePolicySnapshot = 'optional',
    this.requireGroupPhotoSnapshot = false,
    this.requireAttendanceSheetSnapshot = false,
    this.requireTrainingDocumentSnapshot = false,
    this.maxGroupPhotosSnapshot = 10,
    this.submittedAt,
    this.cancelledAt,
    this.createdAt,
    this.updatedAt,
    this.attendees = const [],
    this.selectedTopics = const [],
    this.evidence = const [],
    this.attendeeCount,
    this.topicCount,
    this.coveredTopicCount,
    this.evidenceCount,
  });

  final String id;
  final TrainingSessionStatus status;
  final DateTime? trainingDate;
  final TrainingCategory? category;
  final TrainingType? trainingType;
  final String? trainerName;
  final String? remarks;
  final String? attendanceId;
  final String? siteVisitId;
  final String? storeId;
  final String? accessClientCode;
  final String? businessNameSnapshot;
  final String? stateSnapshot;
  final String? storeCodeSnapshot;
  final String? storeNameSnapshot;
  final bool requireAttendeeSnapshot;
  final bool requireSelectedTopicSnapshot;
  final String topicEvidencePolicySnapshot;
  final bool requireGroupPhotoSnapshot;
  final bool requireAttendanceSheetSnapshot;
  final bool requireTrainingDocumentSnapshot;
  final int maxGroupPhotosSnapshot;
  final DateTime? submittedAt;
  final DateTime? cancelledAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<TrainingAttendee> attendees;
  final List<TrainingSessionTopic> selectedTopics;
  final List<TrainingEvidence> evidence;
  final int? attendeeCount;
  final int? topicCount;
  final int? coveredTopicCount;
  final int? evidenceCount;

  bool get isEditable => status == TrainingSessionStatus.draft;

  factory TrainingSession.fromJson(Map<String, dynamic> envelope) {
    final session = _map(envelope['session']) ?? envelope;
    final categoryJson = _map(envelope['category'] ?? session['category']);
    final typeJson = _map(
      envelope['training_type'] ?? session['training_type'],
    );
    final store = _map(envelope['store'] ?? session['store']);
    final counts = _map(envelope['counts']);
    return TrainingSession(
      id: '${session['id'] ?? ''}',
      status: TrainingSessionStatusValue.parse(session['status']),
      trainingDate: _date(session['training_date']),
      category: categoryJson == null
          ? null
          : TrainingCategory.fromJson(categoryJson),
      trainingType: typeJson == null ? null : TrainingType.fromJson(typeJson),
      trainerName:
          (session['trainer_name_snapshot'] ?? session['trainer_name'])
              as String?,
      remarks: session['remarks'] as String?,
      attendanceId: session['attendance_id'] as String?,
      siteVisitId: session['site_visit_id'] as String?,
      storeId: (session['store_id'] ?? store?['id']) as String?,
      accessClientCode: session['access_client_code'] as String?,
      businessNameSnapshot: session['business_name_snapshot'] as String?,
      stateSnapshot: (session['state_snapshot'] ?? store?['state']) as String?,
      storeCodeSnapshot:
          (session['store_code_snapshot'] ?? store?['store_code']) as String?,
      storeNameSnapshot:
          (session['store_name_snapshot'] ?? store?['store_name']) as String?,
      requireAttendeeSnapshot:
          session['require_attendee_snapshot'] as bool? ??
          categoryJson?['require_attendee'] as bool? ??
          true,
      requireSelectedTopicSnapshot:
          session['require_selected_topic_snapshot'] as bool? ??
          categoryJson?['require_selected_topic'] as bool? ??
          true,
      topicEvidencePolicySnapshot:
          '${session['topic_evidence_policy_snapshot'] ?? categoryJson?['topic_evidence_policy'] ?? 'optional'}',
      requireGroupPhotoSnapshot:
          session['require_group_photo_snapshot'] as bool? ??
          categoryJson?['require_group_photo'] as bool? ??
          false,
      requireAttendanceSheetSnapshot:
          session['require_attendance_sheet_snapshot'] as bool? ??
          categoryJson?['require_attendance_sheet'] as bool? ??
          false,
      requireTrainingDocumentSnapshot:
          session['require_training_document_snapshot'] as bool? ??
          categoryJson?['require_training_document'] as bool? ??
          false,
      maxGroupPhotosSnapshot:
          (session['max_group_photos_snapshot'] as num?)?.toInt() ??
          (categoryJson?['max_group_photos'] as num?)?.toInt() ??
          10,
      submittedAt: _date(session['submitted_at']),
      cancelledAt: _date(session['cancelled_at']),
      createdAt: _date(session['created_at']),
      updatedAt: _date(session['updated_at']),
      attendees: _maps(
        envelope['attendees'],
      ).map(TrainingAttendee.fromJson).toList(),
      selectedTopics: _maps(
        envelope['topics'],
      ).map(TrainingSessionTopic.fromJson).toList(),
      evidence: _maps(
        envelope['evidence'],
      ).map(TrainingEvidence.fromJson).toList(),
      attendeeCount:
          (counts?['attendees'] as num?)?.toInt() ??
          (session['attendee_count'] as num?)?.toInt(),
      topicCount:
          (counts?['topics'] as num?)?.toInt() ??
          (session['topic_count'] as num?)?.toInt(),
      coveredTopicCount: (counts?['topics_covered'] as num?)?.toInt(),
      evidenceCount:
          (counts?['evidence'] as num?)?.toInt() ??
          (session['evidence_count'] as num?)?.toInt(),
    );
  }

  TrainingSession copyWith({
    TrainingSessionStatus? status,
    List<TrainingAttendee>? attendees,
    List<TrainingSessionTopic>? selectedTopics,
    List<TrainingEvidence>? evidence,
  }) => TrainingSession(
    id: id,
    status: status ?? this.status,
    trainingDate: trainingDate,
    category: category,
    trainingType: trainingType,
    trainerName: trainerName,
    remarks: remarks,
    attendanceId: attendanceId,
    siteVisitId: siteVisitId,
    storeId: storeId,
    accessClientCode: accessClientCode,
    businessNameSnapshot: businessNameSnapshot,
    stateSnapshot: stateSnapshot,
    storeCodeSnapshot: storeCodeSnapshot,
    storeNameSnapshot: storeNameSnapshot,
    requireAttendeeSnapshot: requireAttendeeSnapshot,
    requireSelectedTopicSnapshot: requireSelectedTopicSnapshot,
    topicEvidencePolicySnapshot: topicEvidencePolicySnapshot,
    requireGroupPhotoSnapshot: requireGroupPhotoSnapshot,
    requireAttendanceSheetSnapshot: requireAttendanceSheetSnapshot,
    requireTrainingDocumentSnapshot: requireTrainingDocumentSnapshot,
    maxGroupPhotosSnapshot: maxGroupPhotosSnapshot,
    submittedAt: submittedAt,
    cancelledAt: cancelledAt,
    createdAt: createdAt,
    updatedAt: updatedAt,
    attendees: attendees ?? this.attendees,
    selectedTopics: selectedTopics ?? this.selectedTopics,
    evidence: evidence ?? this.evidence,
    attendeeCount: attendeeCount,
    topicCount: topicCount,
    coveredTopicCount: coveredTopicCount,
    evidenceCount: evidenceCount,
  );
}
