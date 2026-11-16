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
  TrainingFlowController({
    required TrainingRepository repository,
    this.activeContextCheck,
  }) : _repository = repository;
  final TrainingRepository _repository;
  final Future<bool> Function()? activeContextCheck;
  TrainingSession? session;
  List<TrainingCategory> categories = [];
  List<TrainingType> types = [];
  List<TrainingTopic> topics = [];
  TrainingCategory? selectedCategory;
  TrainingType? selectedTrainingType;
  static DateTime indiaDate([DateTime? now]) {
    final ist = (now ?? DateTime.now()).toUtc().add(
      const Duration(minutes: 330),
    );
    return DateTime(ist.year, ist.month, ist.day);
  }

  DateTime trainingDate = indiaDate();
  Map<String, dynamic>? selectedStore;
  bool readOnlyContext = false;
  void lockForHistory() {
    readOnlyContext = true;
    notifyListeners();
  }

  String? get retailStoreId => selectedStore?['id'] as String?;
  Future<List<Map<String, dynamic>>> getZones() {
    final categoryCode = selectedCategory?.code;
    if (categoryCode == null) return Future.value([]);
    return _repository.getZones(categoryCode: categoryCode);
  }

  Future<Map<String, dynamic>> searchStores({
    String? zoneId,
    bool supervisorOnly = false,
    String query = '',
    int offset = 0,
  }) => _repository.searchStores(
    categoryCode: selectedCategory?.code ?? '',
    zoneId: zoneId,
    supervisorOnly: supervisorOnly,
    query: query,
    offset: offset,
  );
  void selectStore(Map<String, dynamic> store) {
    _ensureEditable();
    if (session != null) return;
    selectedStore = store;
    isDirty = true;
    notifyListeners();
  }

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
  bool get isEditable => !readOnlyContext && (session?.isEditable ?? true);
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
      trainerName.trim().isNotEmpty &&
      (session != null || retailStoreId != null);
  bool get canContinueAttendees =>
      selectedCategory?.code == 'hk' ||
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
    this.trainingDate = indiaDate();
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
    if (session == null) selectedStore = null;
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
    // Creation date is assigned by the server and is immutable.
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
    await _verifyLocalContext();
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
              retailStoreId: retailStoreId,
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
    await _requireActiveDraft();
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
    await _requireActiveDraft();
    await _repository.removeAttendee(session!.id, attendeeId);
    attendees = attendees.where((item) => item.id != attendeeId).toList();
    notifyListeners();
  }

  Future<void> setSelectedTopics(List<String> topicIds) async {
    await _requireActiveDraft();
    final refreshed = await _repository.setTopics(session!.id, topicIds);
    _applySession(refreshed);
    notifyListeners();
  }

  Future<void> updateTopic(
    String sessionTopicId, {
    required bool isCovered,
    String? remarks,
  }) async {
    await _requireActiveDraft();
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
    await _requireActiveDraft();
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
    await _requireActiveDraft();
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
    await _requireActiveDraft();
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
    await _requireActiveDraft();
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
    await _requireActiveDraft();
    await _repository.deleteEvidence(session!.id, evidenceId);
    evidence = evidence.where((item) => item.id != evidenceId).toList();
    notifyListeners();
  }

  Future<void> refresh() async {
    if (session == null) return;
    await _busy(() => _loadServer(session!.id));
  }

  Future<void> submit() async {
    await _requireActiveDraft();
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
    await _requireActiveDraft();
    _applySession(await _repository.cancel(session!.id));
    notifyListeners();
  }

  void _applySession(TrainingSession value) {
    session = value;
    selectedStore = {
      'id': value.storeId,
      'store_name': value.storeNameSnapshot,
      'store_code': value.storeCodeSnapshot,
    };
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
    trainingDate = value.sessionId == null ? indiaDate() : value.trainingDate;
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
        'Training is read-only. An active Check-In is required to make changes.',
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

  Future<void> _verifyLocalContext() async {
    if (activeContextCheck != null && !await activeContextCheck!()) {
      lockForHistory();
    }
    _ensureEditable();
  }

  Future<void> _requireActiveDraft() async {
    await _verifyLocalContext();
    _ensureServerDraft();
  }
}
