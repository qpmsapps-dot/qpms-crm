import 'training_topic.dart';

DateTime? _date(dynamic value) =>
    value == null ? null : DateTime.tryParse('$value');

class TrainingSessionTopic {
  const TrainingSessionTopic({
    required this.id,
    required this.trainingSessionId,
    required this.topicId,
    this.topic,
    this.isCovered = false,
    this.remarks,
    this.completedAt,
    this.completedBy,
    this.createdAt,
    this.updatedAt,
    this.evidenceCount,
  });
  final String id;
  final String trainingSessionId;
  final String topicId;
  final TrainingTopic? topic;
  final bool isCovered;
  final String? remarks;
  final DateTime? completedAt;
  final String? completedBy;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final int? evidenceCount;
  bool get hasRemarks => remarks?.trim().isNotEmpty == true;
  bool get isCompleted => isCovered;
  factory TrainingSessionTopic.fromJson(Map<String, dynamic> json) =>
      TrainingSessionTopic(
        id: '${json['id'] ?? ''}',
        trainingSessionId: '${json['training_session_id'] ?? ''}',
        topicId: '${json['topic_id'] ?? ''}',
        topic: json['topic'] is Map
            ? TrainingTopic.fromJson(
                Map<String, dynamic>.from(json['topic'] as Map),
              )
            : null,
        isCovered: json['is_covered'] as bool? ?? false,
        remarks: json['remarks'] as String?,
        completedAt: _date(json['completed_at']),
        completedBy: json['completed_by'] as String?,
        createdAt: _date(json['created_at']),
        updatedAt: _date(json['updated_at']),
        evidenceCount: (json['evidence_count'] as num?)?.toInt(),
      );
}
