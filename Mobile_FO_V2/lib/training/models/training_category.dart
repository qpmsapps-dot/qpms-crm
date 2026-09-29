class TrainingCategory {
  const TrainingCategory({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    this.iconKey,
    this.requireAttendee = true,
    this.requireSelectedTopic = true,
    this.topicEvidencePolicy = 'optional',
    this.requireGroupPhoto = false,
    this.requireAttendanceSheet = false,
    this.requireTrainingDocument = false,
    this.maxGroupPhotos = 10,
    this.isActive = true,
    this.sortOrder = 0,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final String? iconKey;
  final bool requireAttendee;
  final bool requireSelectedTopic;
  final String topicEvidencePolicy;
  final bool requireGroupPhoto;
  final bool requireAttendanceSheet;
  final bool requireTrainingDocument;
  final int maxGroupPhotos;
  final bool isActive;
  final int sortOrder;

  factory TrainingCategory.fromJson(Map<String, dynamic> json) =>
      TrainingCategory(
        id: '${json['id'] ?? ''}',
        code: '${json['code'] ?? ''}',
        name: '${json['name'] ?? ''}',
        description: json['description'] as String?,
        iconKey: json['icon_key'] as String?,
        requireAttendee: json['require_attendee'] as bool? ?? true,
        requireSelectedTopic: json['require_selected_topic'] as bool? ?? true,
        topicEvidencePolicy: '${json['topic_evidence_policy'] ?? 'optional'}',
        requireGroupPhoto: json['require_group_photo'] as bool? ?? false,
        requireAttendanceSheet:
            json['require_attendance_sheet'] as bool? ?? false,
        requireTrainingDocument:
            json['require_training_document'] as bool? ?? false,
        maxGroupPhotos: (json['max_group_photos'] as num?)?.toInt() ?? 10,
        isActive: json['is_active'] as bool? ?? true,
        sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'code': code,
    'name': name,
    'description': description,
    'icon_key': iconKey,
    'require_attendee': requireAttendee,
    'require_selected_topic': requireSelectedTopic,
    'topic_evidence_policy': topicEvidencePolicy,
    'require_group_photo': requireGroupPhoto,
    'require_attendance_sheet': requireAttendanceSheet,
    'require_training_document': requireTrainingDocument,
    'max_group_photos': maxGroupPhotos,
    'is_active': isActive,
    'sort_order': sortOrder,
  };

  @override
  bool operator ==(Object other) => other is TrainingCategory && other.id == id;
  @override
  int get hashCode => id.hashCode;
}
