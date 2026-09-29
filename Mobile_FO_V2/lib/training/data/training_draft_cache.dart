import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/training_evidence.dart';

abstract class TrainingCacheStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> remove(String key);
}

class SharedPreferencesTrainingCacheStore implements TrainingCacheStore {
  @override
  Future<String?> read(String key) async =>
      (await SharedPreferences.getInstance()).getString(key);
  @override
  Future<void> write(String key, String value) async {
    await (await SharedPreferences.getInstance()).setString(key, value);
  }

  @override
  Future<void> remove(String key) async {
    await (await SharedPreferences.getInstance()).remove(key);
  }
}

enum TrainingFlowStep { details, attendees, topics, evidence, review }

enum TrainingSyncState { synced, pending, failed }

enum TrainingUploadState { pending, uploading, failed, completed }

class TrainingDraftRecord {
  const TrainingDraftRecord({
    required this.cacheId,
    this.sessionId,
    required this.attendanceId,
    required this.siteVisitId,
    this.categoryId,
    this.trainingTypeId,
    required this.trainingDate,
    required this.trainerName,
    this.remarks,
    this.selectedTopicIds = const [],
    this.currentStep = TrainingFlowStep.details,
    this.syncState = TrainingSyncState.pending,
    this.lastServerSyncAt,
  });
  final String cacheId;
  final String? sessionId;
  final String attendanceId;
  final String siteVisitId;
  final String? categoryId;
  final String? trainingTypeId;
  final DateTime trainingDate;
  final String trainerName;
  final String? remarks;
  final List<String> selectedTopicIds;
  final TrainingFlowStep currentStep;
  final TrainingSyncState syncState;
  final DateTime? lastServerSyncAt;
  Map<String, dynamic> toJson() => {
    'cache_id': cacheId,
    'session_id': sessionId,
    'attendance_id': attendanceId,
    'site_visit_id': siteVisitId,
    'category_id': categoryId,
    'training_type_id': trainingTypeId,
    'training_date': trainingDate.toIso8601String(),
    'trainer_name': trainerName,
    'remarks': remarks,
    'selected_topic_ids': selectedTopicIds,
    'current_step': currentStep.name,
    'sync_state': syncState.name,
    'last_server_sync_at': lastServerSyncAt?.toIso8601String(),
  };
  factory TrainingDraftRecord.fromJson(Map<String, dynamic> json) =>
      TrainingDraftRecord(
        cacheId: '${json['cache_id']}',
        sessionId: json['session_id'] as String?,
        attendanceId: '${json['attendance_id'] ?? ''}',
        siteVisitId: '${json['site_visit_id'] ?? ''}',
        categoryId: json['category_id'] as String?,
        trainingTypeId: json['training_type_id'] as String?,
        trainingDate:
            DateTime.tryParse('${json['training_date']}') ?? DateTime.now(),
        trainerName: '${json['trainer_name'] ?? ''}',
        remarks: json['remarks'] as String?,
        selectedTopicIds: (json['selected_topic_ids'] as List? ?? const [])
            .map((e) => '$e')
            .toList(),
        currentStep: TrainingFlowStep.values.firstWhere(
          (e) => e.name == json['current_step'],
          orElse: () => TrainingFlowStep.details,
        ),
        syncState: TrainingSyncState.values.firstWhere(
          (e) => e.name == json['sync_state'],
          orElse: () => TrainingSyncState.pending,
        ),
        lastServerSyncAt: json['last_server_sync_at'] == null
            ? null
            : DateTime.tryParse('${json['last_server_sync_at']}'),
      );
}

class TrainingPendingEvidence {
  const TrainingPendingEvidence({
    required this.localId,
    required this.sessionId,
    this.sessionTopicId,
    required this.evidenceType,
    required this.localFilePath,
    required this.fileName,
    required this.mimeType,
    required this.fileSize,
    this.state = TrainingUploadState.pending,
    this.retryCount = 0,
    this.retryable = true,
    this.lastError,
    required this.createdAt,
    required this.updatedAt,
  });
  final String localId;
  final String sessionId;
  final String? sessionTopicId;
  final TrainingEvidenceType evidenceType;
  final String localFilePath;
  final String fileName;
  final String mimeType;
  final int fileSize;
  final TrainingUploadState state;
  final int retryCount;
  final bool retryable;
  final String? lastError;
  final DateTime createdAt;
  final DateTime updatedAt;
  TrainingPendingEvidence copyWith({
    TrainingUploadState? state,
    int? retryCount,
    bool? retryable,
    String? lastError,
    DateTime? updatedAt,
  }) => TrainingPendingEvidence(
    localId: localId,
    sessionId: sessionId,
    sessionTopicId: sessionTopicId,
    evidenceType: evidenceType,
    localFilePath: localFilePath,
    fileName: fileName,
    mimeType: mimeType,
    fileSize: fileSize,
    state: state ?? this.state,
    retryCount: retryCount ?? this.retryCount,
    retryable: retryable ?? this.retryable,
    lastError: lastError,
    createdAt: createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  Map<String, dynamic> toJson() => {
    'local_id': localId,
    'session_id': sessionId,
    'session_topic_id': sessionTopicId,
    'evidence_type': evidenceType.wireValue,
    'local_file_path': localFilePath,
    'file_name': fileName,
    'mime_type': mimeType,
    'file_size': fileSize,
    'state': state.name,
    'retry_count': retryCount,
    'retryable': retryable,
    'last_error': lastError,
    'created_at': createdAt.toIso8601String(),
    'updated_at': updatedAt.toIso8601String(),
  };
  factory TrainingPendingEvidence.fromJson(Map<String, dynamic> json) =>
      TrainingPendingEvidence(
        localId: '${json['local_id']}',
        sessionId: '${json['session_id']}',
        sessionTopicId: json['session_topic_id'] as String?,
        evidenceType: TrainingEvidenceTypeValue.parse(
          '${json['evidence_type']}',
        ),
        localFilePath: '${json['local_file_path']}',
        fileName: '${json['file_name']}',
        mimeType: '${json['mime_type']}',
        fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
        state: TrainingUploadState.values.firstWhere(
          (e) => e.name == json['state'],
          orElse: () => TrainingUploadState.pending,
        ),
        retryCount: (json['retry_count'] as num?)?.toInt() ?? 0,
        retryable: json['retryable'] as bool? ?? true,
        lastError: json['last_error'] as String?,
        createdAt: DateTime.tryParse('${json['created_at']}') ?? DateTime.now(),
        updatedAt: DateTime.tryParse('${json['updated_at']}') ?? DateTime.now(),
      );
}

class TrainingDraftCache {
  TrainingDraftCache({TrainingCacheStore? store})
    : _store = store ?? SharedPreferencesTrainingCacheStore();
  final TrainingCacheStore _store;
  static const _draftPrefix = 'structured_training_draft_v1_';
  static const _queueKey = 'structured_training_evidence_queue_v1';
  Future<void> saveDraft(TrainingDraftRecord draft) =>
      _store.write('$_draftPrefix${draft.cacheId}', jsonEncode(draft.toJson()));
  Future<TrainingDraftRecord?> loadDraft(String cacheId) async {
    final raw = await _store.read('$_draftPrefix$cacheId');
    return raw == null
        ? null
        : TrainingDraftRecord.fromJson(
            Map<String, dynamic>.from(jsonDecode(raw) as Map),
          );
  }

  Future<void> clearDraft(String cacheId) =>
      _store.remove('$_draftPrefix$cacheId');
  Future<List<TrainingPendingEvidence>> loadQueue() async {
    final raw = await _store.read(_queueKey);
    if (raw == null) return [];
    return (jsonDecode(raw) as List)
        .whereType<Map>()
        .map(
          (e) => TrainingPendingEvidence.fromJson(Map<String, dynamic>.from(e)),
        )
        .toList();
  }

  Future<void> _saveQueue(List<TrainingPendingEvidence> rows) =>
      _store.write(_queueKey, jsonEncode(rows.map((e) => e.toJson()).toList()));
  Future<void> putPendingEvidence(TrainingPendingEvidence item) async {
    final rows = await loadQueue();
    final index = rows.indexWhere((e) => e.localId == item.localId);
    if (index < 0) {
      rows.add(item);
    } else {
      rows[index] = item;
    }
    await _saveQueue(rows);
  }

  Future<void> removePendingEvidence(String localId) async {
    final rows = await loadQueue();
    rows.removeWhere((e) => e.localId == localId);
    await _saveQueue(rows);
  }

  Future<void> clearSessionQueue(String sessionId) async {
    final rows = await loadQueue();
    rows.removeWhere((e) => e.sessionId == sessionId);
    await _saveQueue(rows);
  }

  Future<List<TrainingPendingEvidence>> queueForSession(
    String sessionId,
  ) async => (await loadQueue())
      .where(
        (e) =>
            e.sessionId == sessionId &&
            e.state != TrainingUploadState.completed,
      )
      .toList();
}
