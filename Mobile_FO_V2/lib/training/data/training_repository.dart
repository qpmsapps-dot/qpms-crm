import 'dart:io';
import 'dart:typed_data';

import '../models/training_attendee.dart';
import '../models/training_category.dart';
import '../models/training_evidence.dart';
import '../models/training_session.dart';
import '../models/training_session_topic.dart';
import '../models/training_topic.dart';
import '../models/training_type.dart';
import 'training_api.dart';
import 'training_draft_cache.dart';
import 'training_errors.dart';

typedef TrainingFileReader = Future<Uint8List> Function(String path);

class TrainingRepository {
  TrainingRepository({
    required TrainingApi api,
    TrainingDraftCache? cache,
    TrainingFileReader? readFile,
  }) : _api = api,
       _cache = cache ?? TrainingDraftCache(),
       _readFile = readFile ?? ((path) => File(path).readAsBytes());
  final TrainingApi _api;
  final TrainingDraftCache _cache;
  final TrainingFileReader _readFile;
  final Set<String> _uploadsInFlight = {};
  List<TrainingCategory>? _categories;
  List<TrainingType>? _types;
  final Map<String, List<TrainingTopic>> _topics = {};

  Future<List<TrainingCategory>> getCategories({bool refresh = false}) async =>
      !refresh && _categories != null
      ? _categories!
      : (_categories = await _api.getCategories());
  Future<List<TrainingType>> getTypes({bool refresh = false}) async =>
      !refresh && _types != null ? _types! : (_types = await _api.getTypes());
  Future<List<TrainingTopic>> getTopics(
    String categoryId, {
    bool refresh = false,
  }) async => !refresh && _topics[categoryId] != null
      ? _topics[categoryId]!
      : (_topics[categoryId] = await _api.getTopics(categoryId: categoryId));
  Future<List<TrainingStaffSuggestion>> searchSiteStaff(
    String siteId, {
    String? query,
    int? limit,
  }) => _api.searchSiteStaff(siteId: siteId, query: query, limit: limit);
  Future<TrainingSession> createSession({
    required String attendanceId,
    required String siteVisitId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) => _api.createSession(
    attendanceId: attendanceId,
    siteVisitId: siteVisitId,
    categoryId: categoryId,
    trainingTypeId: trainingTypeId,
    trainingDate: trainingDate,
    trainerName: trainerName,
    remarks: remarks,
  );
  Future<TrainingSession> getSession(String id) => _api.getSession(id);
  Future<List<TrainingSession>> getSessions({
    bool? mine,
    String? status,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? categoryId,
    String? storeId,
    int? limit,
  }) => _api.getSessions(
    mine: mine,
    status: status,
    dateFrom: dateFrom,
    dateTo: dateTo,
    categoryId: categoryId,
    storeId: storeId,
    limit: limit,
  );
  Future<TrainingSession> updateSession({
    required String sessionId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) => _api.updateSession(
    sessionId: sessionId,
    categoryId: categoryId,
    trainingTypeId: trainingTypeId,
    trainingDate: trainingDate,
    trainerName: trainerName,
    remarks: remarks,
  );
  Future<TrainingAttendee> addAttendee(String sessionId, String profileId) =>
      _api.addAttendee(sessionId: sessionId, profileId: profileId);
  Future<void> removeAttendee(String sessionId, String attendeeId) =>
      _api.removeAttendee(sessionId: sessionId, attendeeId: attendeeId);
  Future<TrainingSession> setTopics(
    String sessionId,
    List<String> topicIds,
  ) async {
    await _api.setTopics(sessionId: sessionId, topicIds: topicIds);
    return _api.getSession(sessionId);
  }

  Future<TrainingSessionTopic> updateSessionTopic(
    String sessionId,
    String sessionTopicId, {
    required bool isCovered,
    String? remarks,
  }) => _api.updateSessionTopic(
    sessionId: sessionId,
    sessionTopicId: sessionTopicId,
    isCovered: isCovered,
    remarks: remarks,
  );
  Future<void> deleteEvidence(String sessionId, String evidenceId) =>
      _api.deleteEvidence(sessionId: sessionId, evidenceId: evidenceId);
  Future<TrainingEvidenceView> getEvidenceViewUrl(
    String sessionId,
    String evidenceId,
  ) => _api.getEvidenceViewUrl(sessionId: sessionId, evidenceId: evidenceId);
  Future<TrainingSession> submit(String sessionId) async {
    final result = await _api.submitSession(sessionId);
    await _cache.clearSessionQueue(sessionId);
    await _cache.clearDraft(sessionId);
    return result;
  }

  Future<TrainingSession> cancel(String sessionId) async {
    final result = await _api.cancelSession(sessionId);
    await _cache.clearDraft(sessionId);
    return result;
  }

  Future<void> saveDraft(TrainingDraftRecord draft) => _cache.saveDraft(draft);
  Future<TrainingDraftRecord?> loadDraft(String id) => _cache.loadDraft(id);
  Future<void> clearDraft(String id) => _cache.clearDraft(id);
  Future<List<TrainingPendingEvidence>> pendingUploads(String sessionId) =>
      _cache.queueForSession(sessionId);

  Future<void> removePendingUpload(String localId) =>
      _cache.removePendingEvidence(localId);

  static const int maxFileBytes = 5 * 1024 * 1024;
  static const _images = {'image/jpeg', 'image/png'};
  static const _pdf = 'application/pdf';
  static void validateEvidence({
    required TrainingEvidenceType type,
    required String mimeType,
    required int fileSize,
    String? sessionTopicId,
  }) {
    if (fileSize <= 0) {
      throw const TrainingValidationException(
        'The selected evidence file is empty.',
        code: 'empty_file',
      );
    }
    if (fileSize > maxFileBytes) {
      throw const TrainingUploadException(
        'Evidence files must be 5 MB or smaller.',
        code: 'file_too_large',
        statusCode: 413,
      );
    }
    final allowed = switch (type) {
      TrainingEvidenceType.topicPhoto ||
      TrainingEvidenceType.groupPhoto => _images,
      TrainingEvidenceType.trainingDocument => {_pdf},
      TrainingEvidenceType.attendanceSheet ||
      TrainingEvidenceType.additionalDocument => {..._images, _pdf},
    };
    if (!allowed.contains(mimeType.toLowerCase())) {
      throw const TrainingUploadException(
        'This file type is not supported for the selected evidence.',
        code: 'unsupported_file_type',
        statusCode: 415,
      );
    }
    if (type == TrainingEvidenceType.topicPhoto &&
        sessionTopicId?.trim().isNotEmpty != true) {
      throw const TrainingValidationException(
        'Topic evidence must be linked to a selected topic.',
        code: 'topic_required',
      );
    }
  }

  Future<TrainingPendingEvidence> enqueueEvidence({
    required String localId,
    required String sessionId,
    String? sessionTopicId,
    required TrainingEvidenceType evidenceType,
    required String localFilePath,
    required String fileName,
    required String mimeType,
    required int fileSize,
  }) async {
    validateEvidence(
      type: evidenceType,
      mimeType: mimeType,
      fileSize: fileSize,
      sessionTopicId: sessionTopicId,
    );
    final now = DateTime.now().toUtc();
    final existing = (await _cache.loadQueue())
        .where((item) => item.localId == localId)
        .toList();
    if (existing.isNotEmpty) return existing.first;
    final item = TrainingPendingEvidence(
      localId: localId,
      sessionId: sessionId,
      sessionTopicId: sessionTopicId,
      evidenceType: evidenceType,
      localFilePath: localFilePath,
      fileName: fileName,
      mimeType: mimeType,
      fileSize: fileSize,
      createdAt: now,
      updatedAt: now,
    );
    await _cache.putPendingEvidence(item);
    return item;
  }

  Future<TrainingEvidence?> uploadPending(TrainingPendingEvidence item) async {
    if (!_uploadsInFlight.add(item.localId)) return null;
    try {
      final uploading = item.copyWith(
        state: TrainingUploadState.uploading,
        updatedAt: DateTime.now().toUtc(),
      );
      await _cache.putPendingEvidence(uploading);
      final bytes = await _readFile(item.localFilePath);
      if (bytes.length != item.fileSize) {
        throw const TrainingValidationException(
          'Evidence file changed after it was selected.',
          code: 'file_changed',
        );
      }
      final intent = await _api.createEvidenceUploadIntent(
        sessionId: item.sessionId,
        evidenceType: item.evidenceType,
        sessionTopicId: item.sessionTopicId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
      );
      await _api.uploadSigned(intent, bytes, item.mimeType);
      final evidence = await _api.completeEvidence(
        sessionId: item.sessionId,
        evidenceId: intent.evidenceId,
        evidenceType: item.evidenceType,
        sessionTopicId: item.sessionTopicId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
      );
      await _cache.removePendingEvidence(item.localId);
      return evidence;
    } on TrainingException catch (error) {
      await _cache.putPendingEvidence(
        item.copyWith(
          state: TrainingUploadState.failed,
          retryCount: item.retryCount + 1,
          retryable: error.retryable,
          lastError: error.message,
          updatedAt: DateTime.now().toUtc(),
        ),
      );
      rethrow;
    } finally {
      _uploadsInFlight.remove(item.localId);
    }
  }

  Future<List<TrainingEvidence>> retryPending(
    String sessionId, {
    int maxRetries = 3,
  }) async {
    final uploaded = <TrainingEvidence>[];
    for (final item in await pendingUploads(sessionId)) {
      if (item.retryCount >= maxRetries || !item.retryable) continue;
      try {
        final result = await uploadPending(item);
        if (result != null) uploaded.add(result);
      } on TrainingException catch (error) {
        if (!error.retryable) continue;
      }
    }
    return uploaded;
  }
}
