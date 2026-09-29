import 'package:flutter/foundation.dart';

import '../data/training_draft_cache.dart';
import '../data/training_errors.dart';
import '../data/training_repository.dart';
import '../models/training_attendee.dart';
import '../models/training_category.dart';
import '../models/training_evidence.dart';
import '../models/training_session.dart';
import '../models/training_session_topic.dart';
import '../models/training_topic.dart';
import '../models/training_type.dart';

class TrainingFlowController extends ChangeNotifier {
  TrainingFlowController({required TrainingRepository repository})
    : _repository = repository;
  final TrainingRepository _repository;
  TrainingSession? session;
  List<TrainingCategory> categories = [];
  List<TrainingType> types = [];
  List<TrainingTopic> topics = [];
  TrainingCategory? selectedCategory;
  TrainingType? selectedTrainingType;
  DateTime trainingDate = DateTime.now();
  String trainerName = '';
  String remarks = '';
  String attendanceId = '';
  String siteVisitId = '';
  String cacheId = '';
  List<TrainingAttendee> attendees = [];
  List<TrainingSessionTopic> selectedSessionTopics = [];
  List<TrainingEvidence> evidence = [];
  List<TrainingPendingEvidence> pendingEvidence = [];
  List<TrainingStaffSuggestion> staffSuggestions = [];
  TrainingFlowStep currentStep = TrainingFlowStep.details;
  TrainingSyncState syncState = TrainingSyncState.synced;
  bool isLoading = false;
  bool isSaving = false;
  bool isUploading = false;
  bool isSubmitting = false;
  bool isSearchingStaff = false;
  bool isDirty = false;
  TrainingException? error;
  TrainingException? staffSearchError;

  bool get isDraft =>
      session == null || session!.status == TrainingSessionStatus.draft;
  bool get isSubmitted => session?.status == TrainingSessionStatus.submitted;
  bool get isCancelled => session?.status == TrainingSessionStatus.cancelled;
  bool get isEditable => !isSubmitted && !isCancelled;
  int get attendeeCount => attendees.length;
  int get selectedTopicCount => selectedSessionTopics.length;
  int get coveredTopicCount =>
      selectedSessionTopics.where((item) => item.isCovered).length;
  double get topicProgress =>
      selectedTopicCount == 0 ? 0 : coveredTopicCount / selectedTopicCount;
  int get photoCount => evidence
      .where(
        (item) =>
            item.evidenceType == TrainingEvidenceType.topicPhoto ||
            item.evidenceType == TrainingEvidenceType.groupPhoto,
      )
      .length;
  int get fileCount => evidence
      .where(
        (item) =>
            item.evidenceType != TrainingEvidenceType.topicPhoto &&
            item.evidenceType != TrainingEvidenceType.groupPhoto,
      )
      .length;
  int get groupPhotoCount => evidence
      .where((item) => item.evidenceType == TrainingEvidenceType.groupPhoto)
      .length;
  bool get hasAttendanceSheet => evidence.any(
    (item) => item.evidenceType == TrainingEvidenceType.attendanceSheet,
  );
  bool get hasTrainingDocument => evidence.any(
    (item) => item.evidenceType == TrainingEvidenceType.trainingDocument,
  );
  int get pendingUploadCount => pendingEvidence
      .where(
        (item) =>
            item.state == TrainingUploadState.pending ||
            item.state == TrainingUploadState.uploading,
      )
      .length;
  int get failedUploadCount => pendingEvidence
      .where((item) => item.state == TrainingUploadState.failed)
      .length;
  bool get canContinueDetails =>
      selectedCategory != null &&
      selectedTrainingType != null &&
      trainerName.trim().isNotEmpty;
  bool get canContinueAttendees =>
      !(session?.requireAttendeeSnapshot ??
          selectedCategory?.requireAttendee ??
          true) ||
      attendees.isNotEmpty;
  bool get canContinueTopics =>
      !(session?.requireSelectedTopicSnapshot ??
          selectedCategory?.requireSelectedTopic ??
          true) ||
      selectedSessionTopics.isNotEmpty;
  bool get canSubmitLocally =>
      isEditable &&
      canContinueDetails &&
      canContinueAttendees &&
      canContinueTopics &&
      pendingUploadCount == 0 &&
      failedUploadCount == 0 &&
      (!(session?.requireGroupPhotoSnapshot ?? false) || groupPhotoCount > 0) &&
      (!(session?.requireAttendanceSheetSnapshot ?? false) ||
          hasAttendanceSheet) &&
      (!(session?.requireTrainingDocumentSnapshot ?? false) ||
          hasTrainingDocument);

  List<TrainingEvidence> evidenceForTopic(String sessionTopicId) => evidence
      .where((item) => item.trainingSessionTopicId == sessionTopicId)
      .toList();
  int topicPhotoCount(String sessionTopicId) => evidenceForTopic(sessionTopicId)
      .where((item) => item.evidenceType == TrainingEvidenceType.topicPhoto)
      .length;
  List<TrainingEvidence> supportingEvidenceByType(TrainingEvidenceType type) =>
      evidence
          .where(
            (item) =>
                item.evidenceType == type &&
                item.trainingSessionTopicId == null,
          )
          .toList();

  Future<void> initializeNew({
    required String attendanceId,
    required String siteVisitId,
    required String trainerName,
    DateTime? trainingDate,
  }) async {
    this.attendanceId = attendanceId;
    this.siteVisitId = siteVisitId;
    this.trainerName = trainerName;
    this.trainingDate = trainingDate ?? DateTime.now();
    cacheId = '$attendanceId:$siteVisitId';
    await _busy(() async {
      await _loadMasters();
      final cached = await _repository.loadDraft(cacheId);
      if (cached != null) {
        _applyDraft(cached);
        if (cached.sessionId != null) await _loadServer(cached.sessionId!);
      }
    });
  }

  Future<void> resume(String sessionId) async {
    cacheId = sessionId;
    await _busy(() async {
      await _loadMasters();
      await _loadServer(sessionId);
    });
  }

  Future<void> _loadMasters() async {
    final values = await Future.wait([
      _repository.getCategories(),
      _repository.getTypes(),
    ]);
    categories = values[0] as List<TrainingCategory>;
    types = values[1] as List<TrainingType>;
  }

  Future<void> _loadServer(String id) async {
    final remote = await _repository.getSession(id);
    _applySession(remote);
    if (remote.category != null) {
      topics = await _repository.getTopics(remote.category!.id, refresh: true);
    }
    if (!remote.isEditable) await _repository.clearDraft(cacheId);
    pendingEvidence = await _repository.pendingUploads(id);
  }

  void selectCategory(TrainingCategory value) {
    _ensureEditable();
    selectedCategory = value;
    selectedSessionTopics = [];
    topics = [];
    isDirty = true;
    syncState = TrainingSyncState.pending;
    notifyListeners();
  }

  Future<void> loadTopics({bool refresh = false}) async {
    if (selectedCategory == null) return;
    topics = await _repository.getTopics(
      selectedCategory!.id,
      refresh: refresh,
    );
    notifyListeners();
  }

  void selectTrainingType(TrainingType value) {
    _ensureEditable();
    selectedTrainingType = value;
    isDirty = true;
    syncState = TrainingSyncState.pending;
    notifyListeners();
  }

  void setDetails({DateTime? date, String? trainer, String? remarks}) {
    _ensureEditable();
    if (date != null) trainingDate = date;
    if (trainer != null) trainerName = trainer;
    if (remarks != null) this.remarks = remarks;
    isDirty = true;
    syncState = TrainingSyncState.pending;
    notifyListeners();
  }

  void goTo(TrainingFlowStep step) {
    currentStep = step;
    notifyListeners();
    _cacheLocal();
  }

  Future<TrainingSession> saveDraft() async {
    _ensureEditable();
    if (!canContinueDetails) {
      throw const TrainingValidationException(
        'Complete the required Training details first.',
      );
    }
    isSaving = true;
    error = null;
    notifyListeners();
    try {
      final previousCacheId = cacheId;
      final result = session == null
          ? await _repository.createSession(
              attendanceId: attendanceId,
              siteVisitId: siteVisitId,
              categoryId: selectedCategory!.id,
              trainingTypeId: selectedTrainingType!.id,
              trainingDate: trainingDate,
              trainerName: trainerName,
              remarks: remarks,
            )
          : await _repository.updateSession(
              sessionId: session!.id,
              categoryId: selectedCategory!.id,
              trainingTypeId: selectedTrainingType!.id,
              trainingDate: trainingDate,
              trainerName: trainerName,
              remarks: remarks,
            );
      _applySession(result);
      cacheId = result.id;
      if (previousCacheId != cacheId) {
        await _repository.clearDraft(previousCacheId);
      }
      isDirty = false;
      syncState = TrainingSyncState.synced;
      await _cacheLocal();
      return result;
    } on TrainingException catch (e) {
      error = e;
      syncState = TrainingSyncState.failed;
      await _cacheLocal();
      rethrow;
    } finally {
      isSaving = false;
      notifyListeners();
    }
  }

  Future<void> persistLocalDraft() => _cacheLocal();

  Future<void> addAttendee(TrainingStaffSuggestion suggestion) async {
    _ensureServerDraft();
    if (attendees.any((item) => item.profileId == suggestion.profileId)) {
      throw const TrainingConflictException('This attendee is already added.');
    }
    final item = await _repository.addAttendee(
      session!.id,
      suggestion.profileId,
    );
    attendees = [...attendees, item];
    notifyListeners();
  }

  Future<void> searchStaff(String query, {int limit = 20}) async {
    if (session?.storeId?.trim().isNotEmpty != true) {
      staffSuggestions = [];
      return;
    }
    isSearchingStaff = true;
    staffSearchError = null;
    notifyListeners();
    try {
      staffSuggestions = await _repository.searchSiteStaff(
        session!.storeId!,
        query: query,
        limit: limit,
      );
    } on TrainingException catch (exception) {
      staffSearchError = exception;
      staffSuggestions = [];
    } finally {
      isSearchingStaff = false;
      notifyListeners();
    }
  }

  Future<void> removeAttendee(String attendeeId) async {
    _ensureServerDraft();
    await _repository.removeAttendee(session!.id, attendeeId);
    attendees = attendees.where((item) => item.id != attendeeId).toList();
    notifyListeners();
  }

  Future<void> setSelectedTopics(List<String> topicIds) async {
    _ensureServerDraft();
    final refreshed = await _repository.setTopics(session!.id, topicIds);
    _applySession(refreshed);
    notifyListeners();
  }

  Future<void> updateTopic(
    String sessionTopicId, {
    required bool isCovered,
    String? remarks,
  }) async {
    _ensureServerDraft();
    final updated = await _repository.updateSessionTopic(
      session!.id,
      sessionTopicId,
      isCovered: isCovered,
      remarks: remarks,
    );
    selectedSessionTopics = selectedSessionTopics
        .map((item) => item.id == updated.id ? updated : item)
        .toList();
    notifyListeners();
  }

  Future<void> queueEvidence({
    required String localId,
    String? sessionTopicId,
    required TrainingEvidenceType type,
    required String path,
    required String fileName,
    required String mimeType,
    required int fileSize,
  }) async {
    _ensureServerDraft();
    final item = await _repository.enqueueEvidence(
      localId: localId,
      sessionId: session!.id,
      sessionTopicId: sessionTopicId,
      evidenceType: type,
      localFilePath: path,
      fileName: fileName,
      mimeType: mimeType,
      fileSize: fileSize,
    );
    pendingEvidence = [
      ...pendingEvidence.where((row) => row.localId != item.localId),
      item,
    ];
    notifyListeners();
  }

  Future<void> uploadQueued(String localId) async {
    _ensureServerDraft();
    final item = pendingEvidence.firstWhere((row) => row.localId == localId);
    isUploading = true;
    notifyListeners();
    try {
      final uploaded = await _repository.uploadPending(item);
      if (uploaded != null) {
        evidence = [
          ...evidence.where((row) => row.id != uploaded.id),
          uploaded,
        ];
      }
    } finally {
      pendingEvidence = await _repository.pendingUploads(session!.id);
      isUploading = false;
      notifyListeners();
    }
  }

  Future<void> removePendingUpload(String localId) async {
    _ensureServerDraft();
    await _repository.removePendingUpload(localId);
    pendingEvidence = pendingEvidence
        .where((item) => item.localId != localId)
        .toList();
    notifyListeners();
  }

  Future<TrainingEvidenceView> getEvidenceViewUrl(String evidenceId) {
    if (session == null) {
      throw const TrainingValidationException(
        'Save the Training details before viewing evidence.',
      );
    }
    return _repository.getEvidenceViewUrl(session!.id, evidenceId);
  }

  void clearError() {
    error = null;
    notifyListeners();
  }

  Future<void> retryUploads() async {
    _ensureServerDraft();
    isUploading = true;
    notifyListeners();
    try {
      final uploaded = await _repository.retryPending(session!.id);
      for (final item in uploaded) {
        evidence = [...evidence.where((row) => row.id != item.id), item];
      }
    } finally {
      pendingEvidence = await _repository.pendingUploads(session!.id);
      isUploading = false;
      notifyListeners();
    }
  }

  Future<void> deleteEvidence(String evidenceId) async {
    _ensureServerDraft();
    await _repository.deleteEvidence(session!.id, evidenceId);
    evidence = evidence.where((item) => item.id != evidenceId).toList();
    notifyListeners();
  }

  Future<void> refresh() async {
    if (session == null) return;
    await _busy(() => _loadServer(session!.id));
  }

  Future<void> submit() async {
    _ensureServerDraft();
    isSubmitting = true;
    notifyListeners();
    try {
      _applySession(await _repository.submit(session!.id));
    } on TrainingException catch (e) {
      error = e;
      rethrow;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }

  Future<void> cancel() async {
    _ensureServerDraft();
    _applySession(await _repository.cancel(session!.id));
    notifyListeners();
  }

  void _applySession(TrainingSession value) {
    session = value;
    selectedCategory = value.category;
    selectedTrainingType = value.trainingType;
    trainingDate = value.trainingDate ?? trainingDate;
    trainerName = value.trainerName ?? trainerName;
    remarks = value.remarks ?? '';
    attendanceId = value.attendanceId ?? attendanceId;
    siteVisitId = value.siteVisitId ?? siteVisitId;
    attendees = value.attendees;
    selectedSessionTopics = value.selectedTopics;
    evidence = value.evidence;
    syncState = TrainingSyncState.synced;
    isDirty = false;
  }

  void _applyDraft(TrainingDraftRecord value) {
    attendanceId = value.attendanceId;
    siteVisitId = value.siteVisitId;
    trainingDate = value.trainingDate;
    trainerName = value.trainerName;
    remarks = value.remarks ?? '';
    currentStep = value.currentStep;
    syncState = value.syncState;
    selectedCategory = _category(value.categoryId);
    selectedTrainingType = _type(value.trainingTypeId);
  }

  TrainingCategory? _category(String? id) {
    for (final item in categories) {
      if (item.id == id) return item;
    }
    return null;
  }

  TrainingType? _type(String? id) {
    for (final item in types) {
      if (item.id == id) return item;
    }
    return null;
  }

  Future<void> _cacheLocal() async {
    if (cacheId.isEmpty) return;
    await _repository.saveDraft(
      TrainingDraftRecord(
        cacheId: cacheId,
        sessionId: session?.id,
        attendanceId: attendanceId,
        siteVisitId: siteVisitId,
        categoryId: selectedCategory?.id,
        trainingTypeId: selectedTrainingType?.id,
        trainingDate: trainingDate,
        trainerName: trainerName,
        remarks: remarks,
        selectedTopicIds: selectedSessionTopics.map((e) => e.topicId).toList(),
        currentStep: currentStep,
        syncState: syncState,
        lastServerSyncAt: syncState == TrainingSyncState.synced
            ? DateTime.now().toUtc()
            : null,
      ),
    );
  }

  Future<void> _busy(Future<void> Function() operation) async {
    isLoading = true;
    error = null;
    notifyListeners();
    try {
      await operation();
    } on TrainingException catch (e) {
      error = e;
      rethrow;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  void _ensureEditable() {
    if (!isEditable) {
      throw const TrainingConflictException(
        'Submitted or cancelled Training sessions cannot be changed.',
      );
    }
  }

  void _ensureServerDraft() {
    _ensureEditable();
    if (session == null) {
      throw const TrainingValidationException(
        'Save the Training details before continuing.',
      );
    }
  }
}
