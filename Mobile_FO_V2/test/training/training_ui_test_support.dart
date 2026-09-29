import 'dart:typed_data';

import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/training/data/training_api.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/data/training_repository.dart';
import 'package:myqpms_fo_v2/training/models/training_attendee.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_type.dart';
import 'package:myqpms_fo_v2/training/state/training_flow_controller.dart';

const testCategory = TrainingCategory(
  id: 'category',
  code: 'hk',
  name: 'Housekeeping (HK)',
  requireAttendee: true,
  requireSelectedTopic: true,
);
const testTechnicalCategory = TrainingCategory(
  id: 'technical',
  code: 'technical_mep',
  name: 'Technical / MEP',
);
const testType = TrainingType(id: 'type', code: 'toolbox', name: 'Toolbox');
const testTopic = TrainingTopic(
  id: 'topic',
  categoryId: 'category',
  code: 'basics',
  moduleName: 'Housekeeping Basics',
  topicDescription: 'Cleaning principles and standards',
);
const testSecondTopic = TrainingTopic(
  id: 'topic-2',
  categoryId: 'category',
  code: 'ppe',
  moduleName: 'PPE & Safety',
  topicDescription: 'Safe working practices',
);
const testUser = FoUser(
  authUserId: 'u',
  employeeCode: 'E',
  fullName: 'Trainer',
  mobile: '',
  email: '',
  state: 'KA',
  role: 'FO',
);

class UiNoopTransport implements TrainingTransport {
  @override
  Future<TrainingHttpResponse> send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async => const TrainingHttpResponse(200, {});
  @override
  Future<void> upload(
    String signedUrl,
    Uint8List bytes,
    String mimeType,
  ) async {}
}

TrainingSession uiSession({
  TrainingSessionStatus status = TrainingSessionStatus.draft,
  List<TrainingAttendee> attendees = const [],
  List<TrainingSessionTopic> topics = const [],
  List<TrainingEvidence> evidence = const [],
}) => TrainingSession(
  id: 'session',
  status: status,
  trainingDate: DateTime(2026, 9, 29),
  category: testCategory,
  trainingType: testType,
  trainerName: 'Trainer',
  attendanceId: 'attendance',
  siteVisitId: 'visit',
  storeId: 'store',
  storeNameSnapshot: 'Reliance Retail Bengaluru',
  stateSnapshot: 'KA',
  attendees: attendees,
  selectedTopics: topics,
  evidence: evidence,
);

class TrainingUiFakeRepository extends TrainingRepository {
  TrainingUiFakeRepository()
    : super(
        api: TrainingApi(user: testUser, transport: UiNoopTransport()),
      );
  TrainingSession remote = uiSession();
  List<TrainingStaffSuggestion> suggestions = const [
    TrainingStaffSuggestion(
      profileId: 'profile',
      employeeCode: 'EMP01',
      name: 'Asha Kumar',
      designation: 'Housekeeper',
      role: 'FO',
    ),
  ];
  bool submitted = false;
  @override
  Future<List<TrainingStaffSuggestion>> searchSiteStaff(
    String siteId, {
    String? query,
    int? limit,
  }) async => suggestions;
  @override
  Future<TrainingAttendee> addAttendee(
    String sessionId,
    String profileId,
  ) async {
    final row = TrainingAttendee(
      id: 'attendee',
      trainingSessionId: sessionId,
      profileId: profileId,
      employeeCode: 'EMP01',
      employeeName: 'Asha Kumar',
      designationSnapshot: 'Housekeeper',
    );
    remote = remote.copyWith(attendees: [row]);
    return row;
  }

  @override
  Future<void> removeAttendee(String sessionId, String attendeeId) async {
    remote = remote.copyWith(attendees: []);
  }

  @override
  Future<TrainingSession> setTopics(
    String sessionId,
    List<String> topicIds,
  ) async {
    final selected = topicIds.map((id) {
      final topic = id == testTopic.id ? testTopic : testSecondTopic;
      return TrainingSessionTopic(
        id: 'session-$id',
        trainingSessionId: sessionId,
        topicId: id,
        topic: topic,
      );
    }).toList();
    remote = remote.copyWith(selectedTopics: selected);
    return remote;
  }

  @override
  Future<TrainingSessionTopic> updateSessionTopic(
    String sessionId,
    String sessionTopicId, {
    required bool isCovered,
    String? remarks,
  }) async {
    final current = remote.selectedTopics.firstWhere(
      (item) => item.id == sessionTopicId,
    );
    final updated = TrainingSessionTopic(
      id: current.id,
      trainingSessionId: current.trainingSessionId,
      topicId: current.topicId,
      topic: current.topic,
      isCovered: isCovered,
      remarks: remarks,
    );
    remote = remote.copyWith(
      selectedTopics: remote.selectedTopics
          .map((item) => item.id == updated.id ? updated : item)
          .toList(),
    );
    return updated;
  }

  @override
  Future<TrainingSession> submit(String sessionId) async {
    submitted = true;
    remote = remote.copyWith(status: TrainingSessionStatus.submitted);
    return remote;
  }

  @override
  Future<TrainingSession> updateSession({
    required String sessionId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) async => remote;
  @override
  Future<void> saveDraft(TrainingDraftRecord draft) async {}
}

TrainingFlowController uiController(
  TrainingUiFakeRepository repository, {
  List<TrainingAttendee> attendees = const [],
  List<TrainingSessionTopic> topics = const [],
  List<TrainingEvidence> evidence = const [],
  TrainingSessionStatus status = TrainingSessionStatus.draft,
}) {
  repository.remote = uiSession(
    status: status,
    attendees: attendees,
    topics: topics,
    evidence: evidence,
  );
  final controller = TrainingFlowController(repository: repository)
    ..categories = [testCategory, testTechnicalCategory]
    ..types = [
      testType,
      const TrainingType(id: 'classroom', code: 'classroom', name: 'Classroom'),
    ]
    ..topics = [testTopic, testSecondTopic]
    ..selectedCategory = testCategory
    ..selectedTrainingType = testType
    ..trainingDate = DateTime(2026, 9, 29)
    ..trainerName = 'Trainer'
    ..attendanceId = 'attendance'
    ..siteVisitId = 'visit'
    ..cacheId = 'session'
    ..session = repository.remote
    ..attendees = attendees
    ..selectedSessionTopics = topics
    ..evidence = evidence;
  return controller;
}
