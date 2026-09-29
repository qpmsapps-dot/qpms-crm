enum TrainingEvidenceType {
  topicPhoto,
  groupPhoto,
  attendanceSheet,
  trainingDocument,
  additionalDocument,
}

extension TrainingEvidenceTypeValue on TrainingEvidenceType {
  String get wireValue => switch (this) {
    TrainingEvidenceType.topicPhoto => 'topic_photo',
    TrainingEvidenceType.groupPhoto => 'group_photo',
    TrainingEvidenceType.attendanceSheet => 'attendance_sheet',
    TrainingEvidenceType.trainingDocument => 'training_document',
    TrainingEvidenceType.additionalDocument => 'additional_document',
  };
  static TrainingEvidenceType parse(String value) =>
      TrainingEvidenceType.values.firstWhere(
        (item) => item.wireValue == value,
        orElse: () => TrainingEvidenceType.additionalDocument,
      );
}

class TrainingEvidence {
  const TrainingEvidence({
    required this.id,
    required this.trainingSessionId,
    this.trainingSessionTopicId,
    required this.evidenceType,
    required this.fileName,
    required this.mimeType,
    required this.fileSize,
    this.createdAt,
  });
  final String id;
  final String trainingSessionId;
  final String? trainingSessionTopicId;
  final TrainingEvidenceType evidenceType;
  final String fileName;
  final String mimeType;
  final int fileSize;
  final DateTime? createdAt;
  factory TrainingEvidence.fromJson(Map<String, dynamic> json) =>
      TrainingEvidence(
        id: '${json['id'] ?? ''}',
        trainingSessionId: '${json['training_session_id'] ?? ''}',
        trainingSessionTopicId: json['training_session_topic_id'] as String?,
        evidenceType: TrainingEvidenceTypeValue.parse(
          '${json['evidence_type'] ?? ''}',
        ),
        fileName: '${json['file_name'] ?? ''}',
        mimeType: '${json['mime_type'] ?? ''}',
        fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
        createdAt: json['created_at'] == null
            ? null
            : DateTime.tryParse('${json['created_at']}'),
      );
}

class TrainingEvidenceUploadIntent {
  const TrainingEvidenceUploadIntent({
    required this.evidenceId,
    required this.signedUploadUrl,
    this.storagePath,
    this.expiresAt,
  });
  final String evidenceId;
  final String signedUploadUrl;
  final String? storagePath;
  final DateTime? expiresAt;
  factory TrainingEvidenceUploadIntent.fromJson(Map<String, dynamic> json) =>
      TrainingEvidenceUploadIntent(
        evidenceId: '${json['evidence_id'] ?? ''}',
        signedUploadUrl: '${json['signed_upload_url'] ?? json['url'] ?? ''}',
        storagePath: json['storage_path'] as String?,
        expiresAt: json['expires_at'] == null
            ? null
            : DateTime.tryParse('${json['expires_at']}'),
      );
}

class TrainingEvidenceView {
  const TrainingEvidenceView({required this.url, this.expiresAt});
  final String url;
  final DateTime? expiresAt;
  factory TrainingEvidenceView.fromJson(Map<String, dynamic> json) =>
      TrainingEvidenceView(
        url: '${json['url'] ?? ''}',
        expiresAt: json['expires_at'] == null
            ? null
            : DateTime.tryParse('${json['expires_at']}'),
      );
}
