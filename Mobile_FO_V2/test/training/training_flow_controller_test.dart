import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/training/data/training_api.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/data/training_errors.dart';
import 'package:myqpms_fo_v2/training/data/training_repository.dart';
import 'package:myqpms_fo_v2/training/models/training_attendee.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_type.dart';
import 'package:myqpms_fo_v2/training/state/training_flow_controller.dart';

class NoopTransport implements TrainingTransport {
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

const user = FoUser(
  authUserId: 'u',
  employeeCode: 'E',
  fullName: 'User',
  mobile: '',
  email: '',
  state: 'KA',
  role: 'FO',
);
const category = TrainingCategory(id: 'c', code: 'hk', name: 'HK');
const type = TrainingType(id: 't', code: 'toolbox', name: 'Toolbox');

TrainingSession makeSession({
  TrainingSessionStatus status = TrainingSessionStatus.draft,
  List<TrainingAttendee> attendees = const [],
  List<TrainingSessionTopic> topics = const [],
  List<TrainingEvidence> evidence = const [],
}) => TrainingSession(
  id: 's',
  status: status,
  trainingDate: DateTime(2026, 9, 29),
  category: category,
  trainingType: type,
  trainerName: 'Trainer',
  attendanceId: 'a',
  siteVisitId: 'v',
  attendees: attendees,
  selectedTopics: topics,
  evidence: evidence,
);

class FakeRepository extends TrainingRepository {
  FakeRepository()
    : super(
        api: TrainingApi(user: user, transport: NoopTransport()),
      );
  TrainingSession remote = makeSession();
  int creates = 0;
  TrainingDraftRecord? draft;
  @override
  Future<List<TrainingCategory>> getCategories({bool refresh = false}) async =>
      [category];
  @override
  Future<List<TrainingType>> getTypes({bool refresh = false}) async => [type];
  @override
  Future<List<TrainingTopic>> getTopics(
    String categoryId, {
    bool refresh = false,
  }) async => [
    const TrainingTopic(
      id: 'topic',
      categoryId: 'c',
      code: 'basics',
      moduleName: 'Basics',
    ),
  ];
  @override
  Future<TrainingDraftRecord?> loadDraft(String id) async => draft;
  @override
  Future<void> saveDraft(TrainingDraftRecord value) async {
    draft = value;
  }

  @override
  Future<void> clearDraft(String id) async {
    draft = null;
  }

  @override
  Future<TrainingSession> getSession(String id) async => remote;
  @override
  Future<List<TrainingPendingEvidence>> pendingUploads(
    String sessionId,
  ) async => [];
  @override
  Future<TrainingSession> createSession({
    required String attendanceId,
    required String siteVisitId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) async {
    creates++;
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
  Future<TrainingAttendee> addAttendee(
    String sessionId,
    String profileId,
  ) async {
    final attendee = TrainingAttendee(
      id: 'a1',
      trainingSessionId: sessionId,
      profileId: profileId,
      employeeCode: 'E1',
      employeeName: 'One',
    );
    remote = remote.copyWith(attendees: [...remote.attendees, attendee]);
    return attendee;
  }

  @override
  Future<void> removeAttendee(String sessionId, String attendeeId) async {}
  @override
  Future<TrainingSession> setTopics(
    String sessionId,
    List<String> topicIds,
  ) async {
    remote = remote.copyWith(
      selectedTopics: [
        const TrainingSessionTopic(
          id: 'st',
          trainingSessionId: 's',
          topicId: 'topic',
        ),
      ],
    );
    return remote;
  }

  @override
  Future<TrainingSessionTopic> updateSessionTopic(
    String sessionId,
    String sessionTopicId, {
    required bool isCovered,
    String? remarks,
  }) async => TrainingSessionTopic(
    id: sessionTopicId,
    trainingSessionId: sessionId,
    topicId: 'topic',
    isCovered: isCovered,
    remarks: remarks,
  );
  @override
  Future<TrainingSession> submit(String sessionId) async {
    remote = makeSession(status: TrainingSessionStatus.submitted);
    return remote;
  }

  @override
  Future<TrainingSession> cancel(String sessionId) async {
    remote = makeSession(status: TrainingSessionStatus.cancelled);
    return remote;
  }
}

void main() {
  test(
    'new initialization loads masters but does not create abandoned server session',
    () async {
      final repository = FakeRepository();
      final controller = TrainingFlowController(repository: repository);
      await controller.initializeNew(
        attendanceId: 'a',
        siteVisitId: 'v',
        trainerName: 'User',
      );
      expect(controller.categories, [category]);
      expect(controller.types, [type]);
      expect(repository.creates, 0);
      expect(controller.session, isNull);
    },
  );

  test(
    'details selection, local validation and Save Draft create server draft',
    () async {
      final repository = FakeRepository();
      final controller = TrainingFlowController(repository: repository);
      await controller.initializeNew(
        attendanceId: 'a',
        siteVisitId: 'v',
        trainerName: 'User',
      );
      controller.selectCategory(category);
      controller.selectTrainingType(type);
      expect(controller.canContinueDetails, isTrue);
      await controller.saveDraft();
      expect(repository.creates, 1);
      expect(controller.session?.id, 's');
      expect(controller.isDirty, isFalse);
    },
  );

  test(
    'attendee/topic updates and computed progress use typed state',
    () async {
      final repository = FakeRepository();
      final controller = TrainingFlowController(repository: repository);
      await controller.resume('s');
      await controller.addAttendee(
        const TrainingStaffSuggestion(
          profileId: 'p',
          employeeCode: 'E1',
          name: 'One',
        ),
      );
      await controller.setSelectedTopics(['topic']);
      await controller.updateTopic('st', isCovered: true, remarks: 'Done');
      expect(controller.attendeeCount, 1);
      expect(controller.selectedTopicCount, 1);
      expect(controller.coveredTopicCount, 1);
      expect(controller.topicProgress, 1);
    },
  );

  test('evidence derived counts and topic mapping are ready for UI', () async {
    final evidence = [
      TrainingEvidence(
        id: 'p',
        trainingSessionId: 's',
        trainingSessionTopicId: 'st',
        evidenceType: TrainingEvidenceType.topicPhoto,
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3,
      ),
      TrainingEvidence(
        id: 'd',
        trainingSessionId: 's',
        evidenceType: TrainingEvidenceType.trainingDocument,
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSize: 3,
      ),
    ];
    final repository = FakeRepository()
      ..remote = makeSession(evidence: evidence);
    final controller = TrainingFlowController(repository: repository);
    await controller.resume('s');
    expect(controller.photoCount, 1);
    expect(controller.fileCount, 1);
    expect(controller.topicPhotoCount('st'), 1);
    expect(controller.hasTrainingDocument, isTrue);
  });

  test('submitted and cancelled server states win and are immutable', () async {
    for (final status in [
      TrainingSessionStatus.submitted,
      TrainingSessionStatus.cancelled,
    ]) {
      final repository = FakeRepository();
      repository.remote = makeSession(status: status);
      repository.draft = TrainingDraftRecord(
        cacheId: 's',
        sessionId: 's',
        attendanceId: 'old',
        siteVisitId: 'old',
        trainingDate: DateTime(2020),
        trainerName: 'Stale',
      );
      final controller = TrainingFlowController(repository: repository);
      await controller.resume('s');
      expect(controller.isEditable, isFalse);
      expect(repository.draft, isNull);
      expect(
        () => controller.setDetails(trainer: 'Changed'),
        throwsA(isA<TrainingConflictException>()),
      );
    }
  });

  test('submit and cancel replace controller session state', () async {
    final repository = FakeRepository();
    final controller = TrainingFlowController(repository: repository);
    await controller.resume('s');
    await controller.submit();
    expect(controller.isSubmitted, isTrue);
    repository.remote = makeSession();
    await controller.resume('s');
    await controller.cancel();
    expect(controller.isCancelled, isTrue);
  });
}
