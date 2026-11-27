import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../data/training_api.dart';
import '../data/training_repository.dart';
import '../data/training_draft_cache.dart';
import '../models/training_category.dart';
import '../models/training_evidence.dart';
import '../models/training_session.dart';
import '../models/training_session_topic.dart';
import '../models/training_topic.dart';
import '../models/training_type.dart';
import 'mepc_form_controller.dart';

// No inheritance from the FO controller, attendance or visit context.
class ManagementTrainingController extends MepcFormController {
  ManagementTrainingController({
    required this.api,
    required this.repository,
    required this.setup,
    required this.creationKey,
    this.persistenceKey,
  });
  final TrainingApi api;
  final TrainingRepository repository;
  final Map<String, dynamic> setup;
  final String creationKey;
  final String? persistenceKey;
  Map<String, dynamic>? _creationBody;
  Future<void> restore() async {
    if (persistenceKey == null) return;
    final raw = (await SharedPreferences.getInstance()).getString(
      persistenceKey!,
    );
    if (raw == null) return;
    final intent = Map<String, dynamic>.from(jsonDecode(raw));
    final body = intent['body'];
    if (body is Map) {
      _creationBody = Map<String, dynamic>.from(body);
      selectedTrainingType = types.firstWhere(
        (t) => t.id == body['training_type_id'],
      );
      remarks = body['remarks'] as String? ?? '';
      _sessionId = intent['session_id'] as String?;
      if (_sessionId != null) {
        await _load(_sessionId!);
        remarks = session!.remarks ?? '';
      } else {
        await saveDraft();
      }
    }
  }

  Future<void> _persistCreation() async {
    if (persistenceKey == null) return;
    await (await SharedPreferences.getInstance()).setString(
      persistenceKey!,
      jsonEncode({
        'setup': setup,
        'key': creationKey,
        'body': _creationBody,
        'session_id': _sessionId,
      }),
    );
  }

  @override
  TrainingSession? session;
  List<Map<String, dynamic>> duplicateCandidates = [];
  @override
  List<String> get overlapWarnings => duplicateCandidates
      .map(
        (s) =>
            'Possible overlapping report: ${s['id']} (${s['status']}). Review permitted reports; multiple sessions are allowed.',
      )
      .toList();
  @override
  TrainingCategory? get selectedCategory => TrainingCategory.fromJson({
    ...Map<String, dynamic>.from(setup['category']),
    'require_attendee': false,
    'require_selected_topic': true,
    'topic_evidence_policy': 'required',
  });
  @override
  TrainingType? selectedTrainingType;
  @override
  Map<String, dynamic> get selectedStore =>
      Map<String, dynamic>.from(setup['store']);
  @override
  DateTime get trainingDate => DateTime.parse(setup['training_date']);
  @override
  String get trainerName =>
      '${setup['trainer']['full_name'] ?? setup['trainer']['employee_code']}';
  @override
  String remarks = '';
  @override
  List<TrainingType> get types => _types;
  late final List<TrainingType> _types = (setup['types'] as List)
      .map((e) => TrainingType.fromJson(Map<String, dynamic>.from(e)))
      .toList();
  @override
  List<TrainingTopic> get topics => (setup['topics'] as List)
      .map((e) => TrainingTopic.fromJson(Map<String, dynamic>.from(e)))
      .toList();
  @override
  List<TrainingSessionTopic> selectedSessionTopics = [];
  @override
  List<TrainingEvidence> evidence = [];
  @override
  List<TrainingPendingEvidence> pendingEvidence = [];
  @override
  bool get isEditable => session?.isEditable ?? true;
  @override
  bool get isSubmitted => session?.status == TrainingSessionStatus.submitted;
  @override
  bool get canContinueDetails =>
      selectedTrainingType != null && selectedStore['id'] != null;
  void _assertDraft() {
    if (!isEditable) throw StateError('Submitted Training is read only.');
  }

  @override
  void selectTrainingType(TrainingType value) {
    _assertDraft();
    if (session != null) return;
    selectedTrainingType = value;
    notifyListeners();
  }

  @override
  void selectStore(Map<String, dynamic> store) =>
      throw StateError('Start a separate report to change the verified store.');
  @override
  void setDetails({DateTime? date, String? trainer, String? remarks}) {
    _assertDraft();
    if (remarks != null) this.remarks = remarks;
  }

  @override
  List<TrainingEvidence> evidenceForTopic(String id) =>
      evidence.where((e) => e.trainingSessionTopicId == id).toList();
  @override
  Future<TrainingSession> saveDraft() async {
    _assertDraft();
    if (!canContinueDetails) throw StateError('Select a Training type.');
    if (session == null && _sessionId == null) {
      _creationBody ??= {
        'retail_store_id': selectedStore['id'],
        'training_date': setup['training_date'],
        'training_type_id': selectedTrainingType!.id,
        'actual_trainer_profile_id': setup['trainer']['id'],
        'creation_key': creationKey,
        'remarks': remarks,
      };
      await _persistCreation();
      final result = await api.createManagementSession(_creationBody!);
      duplicateCandidates = (result['duplicate_candidates'] as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      // Remember accepted creation before any subsequent network request fails.
      _sessionId = result['id'] as String;
      await _persistCreation();
    }
    final id = session?.id ?? _sessionId!;
    await _load(id);
    if (session!.isEditable && session!.remarks != remarks) {
      await repository.updateSession(
        sessionId: id,
        categoryId: selectedCategory!.id,
        trainingTypeId: selectedTrainingType!.id,
        trainingDate: trainingDate,
        trainerName: trainerName,
        remarks: remarks,
      );
      await _load(id);
    }
    return session!;
  }

  String? _sessionId;
  Future<void> resume(String id) => _load(id);
  Future<void> _load(String id) async {
    final remote = await repository.getSession(id);
    session = remote;
    final type = remote.trainingType;
    if (type != null && !types.any((t) => t.id == type.id)) types.add(type);
    selectedTrainingType = type == null
        ? null
        : types.firstWhere((t) => t.id == type.id);
    selectedSessionTopics = remote.selectedTopics;
    evidence = remote.evidence;
    pendingEvidence = await repository.pendingUploads(id);
    notifyListeners();
  }

  @override
  Future<void> setSelectedTopics(List<String> ids) async {
    _assertDraft();
    await repository.setTopics(session!.id, ids);
    await refresh();
  }

  @override
  Future<void> updateTopic(
    String id, {
    required bool isCovered,
    String? remarks,
  }) async {
    _assertDraft();
    await repository.updateSessionTopic(
      session!.id,
      id,
      isCovered: isCovered,
      remarks: remarks,
    );
    await refresh();
  }

  @override
  Future<void> queueEvidence({
    required String localId,
    String? sessionTopicId,
    required TrainingEvidenceType type,
    required String path,
    required String fileName,
    required String mimeType,
    required int fileSize,
  }) async {
    _assertDraft();
    await repository.enqueueEvidence(
      localId: localId,
      sessionId: session!.id,
      sessionTopicId: sessionTopicId,
      evidenceType: type,
      localFilePath: path,
      fileName: fileName,
      mimeType: mimeType,
      fileSize: fileSize,
    );
    pendingEvidence = await repository.pendingUploads(session!.id);
    notifyListeners();
  }

  @override
  Future<void> uploadQueued(String id) async {
    _assertDraft();
    try {
      await repository.uploadPending(
        pendingEvidence.firstWhere((e) => e.localId == id),
      );
    } finally {
      await refresh();
    }
  }

  @override
  Future<void> retryUploads() async {
    _assertDraft();
    try {
      // One attempt per retryable file for this explicit user action. The shared
      // automatic-batch retry cap must not permanently strand a saved report.
      for (final item in await repository.pendingUploads(session!.id)) {
        if (item.retryable) {
          await repository.uploadPending(item);
        }
      }
    } finally {
      await refresh();
    }
  }

  @override
  Future<void> deleteEvidence(String id) async {
    _assertDraft();
    await repository.deleteEvidence(session!.id, id);
    await refresh();
  }

  @override
  Future<TrainingEvidenceView> getEvidenceViewUrl(String id) =>
      repository.getEvidenceViewUrl(session!.id, id);
  @override
  Future<void> refresh() async {
    if (session != null || _sessionId != null) {
      await _load(session?.id ?? _sessionId!);
    }
  }

  @override
  Future<void> submit() async {
    _assertDraft();
    if (pendingEvidence.isNotEmpty ||
        selectedSessionTopics.isEmpty ||
        !evidence.any(
          (e) =>
              e.isUploaded &&
              e.evidenceType == TrainingEvidenceType.additionalDocument,
        ) ||
        selectedSessionTopics.any(
          (t) =>
              !t.isCovered ||
              !evidenceForTopic(t.id).any(
                (e) =>
                    e.isUploaded &&
                    e.evidenceType == TrainingEvidenceType.topicPhoto,
              ),
        )) {
      throw StateError(
        'Verified photographs and completion proof are required.',
      );
    }
    await repository.submit(session!.id);
    await refresh();
  }
}
