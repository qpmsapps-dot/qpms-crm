import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:myqpms_fo_v2/training/data/training_api.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/screens/mepc_training_screen.dart';
import 'package:myqpms_fo_v2/training/state/management_training_controller.dart';
import 'package:myqpms_fo_v2/training/training_launcher.dart';
import 'package:myqpms_fo_v2/utils/mobile_roles.dart';
import 'training_ui_test_support.dart';
import 'training_api_test.dart' show FakeTransport;

Map<String, dynamic> managementSetup() => {
  'store': {
    'id': 'store',
    'store_code': 'SYN-MEPC-01',
    'store_name': 'Synthetic Retail Store',
  },
  'trainer': {
    'id': 'actual-trainer',
    'employee_code': 'SYN-FO',
    'full_name': 'Actual trainer (synthetic)',
  },
  'category': {'id': 'technical', 'code': 'technical_mep', 'name': 'MEPC'},
  'types': [testType.toJson()],
  'topics': [testTopic.toJson()],
  'training_date': '2026-11-27',
};

class ManagementApiFake extends TrainingApi {
  ManagementApiFake() : super(user: testUser, transport: UiNoopTransport());
  final calls = <Map<String, dynamic>>[];
  bool ambiguous = false;
  @override
  Future<Map<String, dynamic>> createManagementSession(
    Map<String, dynamic> body,
  ) async {
    calls.add(Map.of(body));
    if (ambiguous) {
      ambiguous = false;
      throw StateError('Response lost; retry');
    }
    return {
      'id': 'management-session',
      'duplicate_candidates': [
        {'id': 'overlap', 'status': 'submitted'},
      ],
    };
  }
}

class ManagementRepoFake extends TrainingUiFakeRepository {
  int foCreates = 0;
  @override
  Future<TrainingSession> getSession(String id) async => remote;
  @override
  Future<TrainingSession> createSession({
    required String attendanceId,
    required String siteVisitId,
    String? retailStoreId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) async {
    foCreates++;
    throw StateError('FO creation must never run');
  }
}

class ManualRetryRepo extends ManagementRepoFake {
  List<TrainingPendingEvidence> pending = [];
  final attempted = <String>[];
  @override
  Future<List<TrainingPendingEvidence>> pendingUploads(
    String sessionId,
  ) async => List.of(pending);
  @override
  Future<TrainingEvidence?> uploadPending(TrainingPendingEvidence item) async {
    attempted.add(item.localId);
    pending.removeWhere((e) => e.localId == item.localId);
    return null;
  }
}

ManagementTrainingController managementController(
  ManagementApiFake api,
  ManagementRepoFake repo, {
  String? persistenceKey,
}) {
  repo.remote = TrainingSession(
    id: 'management-session',
    status: TrainingSessionStatus.draft,
    category: const TrainingCategory(
      id: 'technical',
      code: 'technical_mep',
      name: 'MEPC',
      requireAttendee: false,
      topicEvidencePolicy: 'required',
    ),
    trainingType: testType,
    canEdit: true,
    completionPolicyVersion: 2,
    requireAttendeeSnapshot: false,
    topicEvidencePolicySnapshot: 'required',
  );
  return ManagementTrainingController(
    api: api,
    repository: repo,
    setup: managementSetup(),
    creationKey: 'durable-key',
    persistenceKey: persistenceKey,
  )..selectTrainingType(testType);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test(
    'explicit management evidence retry attempts capped retryable files once and leaves invalid files blocked',
    () async {
      final repo = ManualRetryRepo();
      final c = managementController(ManagementApiFake(), repo);
      await c.saveDraft();
      final item = TrainingPendingEvidence(
        localId: 'retry',
        sessionId: 'management-session',
        evidenceType: TrainingEvidenceType.additionalDocument,
        localFilePath: 'synthetic.pdf',
        fileName: 'synthetic.pdf',
        mimeType: 'application/pdf',
        fileSize: 10,
        retryCount: 3,
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      );
      repo.pending = [
        item,
        TrainingPendingEvidence(
          localId: 'invalid',
          sessionId: item.sessionId,
          evidenceType: item.evidenceType,
          localFilePath: item.localFilePath,
          fileName: item.fileName,
          mimeType: item.mimeType,
          fileSize: item.fileSize,
          retryable: false,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        ),
      ];
      await c.retryUploads();
      expect(repo.attempted, ['retry']);
      expect(c.pendingEvidence.single.localId, 'invalid');
      await expectLater(c.submit(), throwsStateError);
    },
  );
  test(
    'mobile API calls only the dedicated management setup and create endpoints',
    () async {
      final transport = FakeTransport();
      transport.responses['GET /api/training/mobile-management/setup'] =
          TrainingHttpResponse(200, {'setup': managementSetup()});
      transport.responses['POST /api/training/mobile-management/sessions'] =
          const TrainingHttpResponse(201, {'id': 'management-session'});
      final api = TrainingApi(user: testUser, transport: transport);
      await api.managementSetup(
        storeCode: 'SYN-MEPC-01',
        trainerCode: 'SYN-FO',
        date: '2026-11-27',
      );
      await api.createManagementSession({'creation_key': 'stable'});
      expect(transport.calls.map((c) => c.path), [
        '/api/training/mobile-management/setup',
        '/api/training/mobile-management/sessions',
      ]);
      expect(transport.calls.first.query, {
        'store_code': 'SYN-MEPC-01',
        'trainer_employee_code': 'SYN-FO',
        'training_date': '2026-11-27',
      });
      expect(transport.calls.last.body, {'creation_key': 'stable'});
    },
  );
  test(
    'management admission is explicit; MIS gets no FO creator/admin/BD capabilities',
    () {
      for (final role in ['MIS_MEPC', 'Operations Manager']) {
        expect(isMobileLoginRole(role), isTrue);
        expect(usesManagementTrainingShell(role, 'Reliance Retail'), isTrue);
        expect(isTrainingCreatorRole(role), isFalse);
      }
      expect(mobileRegistrationRoles.contains('MIS_MEPC'), isFalse);
      expect(isAdminRole('MIS_MEPC'), isFalse);
      expect(canAccessBusinessDevelopmentModule('MIS_MEPC'), isFalse);
      for (final role in [
        'FO',
        'MIS_HK',
        'Branch Head',
        'KAM',
        'Admin',
        'unknown',
      ]) {
        expect(usesManagementTrainingShell(role, 'Reliance Retail'), isFalse);
      }
      expect(usesManagementTrainingShell('MIS_MEPC', 'Hospitals'), isFalse);
    },
  );
  test(
    'management creation uses no FO attendance or site visit and preserves actual trainer identity',
    () async {
      final api = ManagementApiFake(), repo = ManagementRepoFake();
      final c = managementController(api, repo);
      await c.saveDraft();
      expect(repo.foCreates, 0);
      expect(api.calls.single['actual_trainer_profile_id'], 'actual-trainer');
      expect(api.calls.single.containsKey('attendance_id'), isFalse);
      expect(api.calls.single.containsKey('site_visit_id'), isFalse);
      expect(c.overlapWarnings.single, contains('overlap'));
    },
  );
  test(
    'ambiguous create retry uses the exact durable original payload after restart',
    () async {
      final api = ManagementApiFake()..ambiguous = true,
          repo = ManagementRepoFake();
      final c = managementController(api, repo, persistenceKey: 'intent')
        ..remarks = 'Original';
      await expectLater(c.saveDraft(), throwsStateError);
      final restarted = managementController(
        api,
        repo,
        persistenceKey: 'intent',
      );
      await restarted.restore();
      expect(api.calls.length, 2);
      expect(api.calls.first, api.calls.last);
      final intent = jsonDecode(
        (await SharedPreferences.getInstance()).getString('intent')!,
      );
      expect(intent['session_id'], 'management-session');
      final third = managementController(api, repo, persistenceKey: 'intent');
      await third.restore();
      expect(
        api.calls.length,
        2,
        reason: 'Accepted creation is resumed by ID, never recreated',
      );
    },
  );
  for (final failure in [
    'no topic',
    'missing proof',
    'pending photo',
    'pending proof',
    'uncovered topic',
  ]) {
    test('management submission rejects $failure', () async {
      final api = ManagementApiFake(), repo = ManagementRepoFake();
      final c = managementController(api, repo);
      await c.saveDraft();
      final topic = TrainingSessionTopic(
        id: 'selected',
        trainingSessionId: 'management-session',
        topicId: testTopic.id,
        isCovered: failure != 'uncovered topic',
      );
      c.selectedSessionTopics = failure == 'no topic' ? [] : [topic];
      c.evidence = [
        TrainingEvidence(
          id: 'photo',
          trainingSessionId: 'management-session',
          trainingSessionTopicId: 'selected',
          evidenceType: TrainingEvidenceType.topicPhoto,
          fileName: 'photo.png',
          mimeType: 'image/png',
          fileSize: 10,
          isUploaded: failure != 'pending photo',
        ),
        if (failure != 'missing proof')
          TrainingEvidence(
            id: 'proof',
            trainingSessionId: 'management-session',
            evidenceType: TrainingEvidenceType.additionalDocument,
            fileName: 'proof.pdf',
            mimeType: 'application/pdf',
            fileSize: 10,
            isUploaded: failure != 'pending proof',
          ),
      ];
      await expectLater(c.submit(), throwsStateError);
      expect(repo.submitted, isFalse);
    });
  }
  testWidgets(
    'management single page retains store/trainer, today date and no Check-In requirement',
    (tester) async {
      final c = managementController(ManagementApiFake(), ManagementRepoFake());
      await tester.pumpWidget(
        MaterialApp(home: MepcTrainingScreen(controller: c, management: true)),
      );
      expect(find.text('SYN-MEPC-01 — Synthetic Retail Store'), findsOneWidget);
      expect(find.text('Actual trainer (synthetic)'), findsOneWidget);
      expect(find.text('2026-11-27'), findsOneWidget);
      expect(find.textContaining('Start Day'), findsNothing);
      expect(tester.takeException(), isNull);
      c.session = const TrainingSession(
        id: 'management-session',
        status: TrainingSessionStatus.submitted,
        canEdit: false,
      );
      await tester.pumpWidget(
        MaterialApp(home: MepcTrainingScreen(controller: c, management: true)),
      );
      expect(
        find.text('Read only \u2014 submitted Training report.'),
        findsOneWidget,
      );
      expect(find.textContaining('Check-In'), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Submit'), findsNothing);
    },
  );
}
