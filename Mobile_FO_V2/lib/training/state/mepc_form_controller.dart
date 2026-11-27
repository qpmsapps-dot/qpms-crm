import 'package:flutter/foundation.dart';
import '../data/training_draft_cache.dart';
import '../models/training_category.dart';
import '../models/training_evidence.dart';
import '../models/training_session.dart';
import '../models/training_session_topic.dart';
import '../models/training_topic.dart';
import '../models/training_type.dart';

// Presentation contract only. FO and management retain separate creation logic.
abstract class MepcFormController extends ChangeNotifier {
  List<String> get overlapWarnings => const [];
  TrainingSession? get session;
  TrainingCategory? get selectedCategory;
  TrainingType? get selectedTrainingType;
  Map<String, dynamic>? get selectedStore;
  DateTime get trainingDate;
  String get trainerName;
  String get remarks;
  List<TrainingType> get types;
  List<TrainingTopic> get topics;
  List<TrainingSessionTopic> get selectedSessionTopics;
  List<TrainingEvidence> get evidence;
  List<TrainingPendingEvidence> get pendingEvidence;
  bool get isEditable;
  bool get isSubmitted;
  bool get canContinueDetails;
  void selectTrainingType(TrainingType value);
  void selectStore(Map<String, dynamic> store);
  void setDetails({DateTime? date, String? trainer, String? remarks});
  List<TrainingEvidence> evidenceForTopic(String sessionTopicId);
  Future<TrainingSession> saveDraft();
  Future<void> setSelectedTopics(List<String> topicIds);
  Future<void> updateTopic(
    String sessionTopicId, {
    required bool isCovered,
    String? remarks,
  });
  Future<void> queueEvidence({
    required String localId,
    String? sessionTopicId,
    required TrainingEvidenceType type,
    required String path,
    required String fileName,
    required String mimeType,
    required int fileSize,
  });
  Future<void> uploadQueued(String localId);
  Future<void> retryUploads();
  Future<void> deleteEvidence(String evidenceId);
  Future<TrainingEvidenceView> getEvidenceViewUrl(String evidenceId);
  Future<void> refresh();
  Future<void> submit();
}
