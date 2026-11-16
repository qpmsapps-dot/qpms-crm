import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/screens/hk_training_screen.dart';
import 'package:myqpms_fo_v2/training/widgets/training_stepper.dart';

import 'training_ui_test_support.dart';

const hk = TrainingCategory(
  id: 'category',
  code: 'hk',
  name: 'HK',
  requireAttendee: false,
);

class SlowSubmitRepository extends TrainingUiFakeRepository {
  final completion = Completer<void>();
  int submissions = 0;
  @override
  Future<TrainingSession> submit(String sessionId) async {
    submissions++;
    await completion.future;
    remote = remote.copyWith(status: TrainingSessionStatus.submitted);
    return remote;
  }
}

void main() {
  const requiredHk = TrainingCategory(
    id: 'category',
    code: 'hk',
    name: 'HK',
    requireAttendee: false,
    topicEvidencePolicy: 'required',
  );
  testWidgets(
    'v4 required topic policy enables new HK Submit without changing the policy',
    (tester) async {
      final c = uiController(TrainingUiFakeRepository())
        ..session = null
        ..selectedCategory = requiredHk;
      await tester.pumpWidget(
        MaterialApp(home: HkTrainingScreen(controller: c)),
      );
      expect(
        find.textContaining('HK master policy is incompatible'),
        findsNothing,
      );
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull,
      );
      expect(c.selectedCategory!.topicEvidencePolicy, 'required');
    },
  );
  test(
    'photo selection or pending server metadata is not uploaded evidence',
    () {
      final data = {
        'id': 'photo',
        'training_session_id': 'session',
        'evidence_type': 'topic_photo',
        'mime_type': 'image/jpeg',
        'file_size': 3,
      };
      expect(TrainingEvidence.fromJson(data).isUploaded, isFalse);
      expect(
        TrainingEvidence.fromJson({
          ...data,
          'metadata': {'upload_status': 'pending'},
        }).isUploaded,
        isFalse,
      );
      expect(
        TrainingEvidence.fromJson({
          ...data,
          'metadata': {'upload_status': 'uploaded'},
        }).isUploaded,
        isTrue,
      );
    },
  );
  for (final uploaded in [false, true]) {
    testWidgets('v4 HK submit requires confirmed per-topic photo: $uploaded', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = TrainingUiFakeRepository();
      const topic = TrainingSessionTopic(
        id: 'session-topic',
        trainingSessionId: 'session',
        topicId: 'topic',
        topic: testTopic,
        isCovered: true,
      );
      final photos = [
        const TrainingEvidence(
          id: 'proof',
          trainingSessionId: 'session',
          evidenceType: TrainingEvidenceType.additionalDocument,
          fileName: 'proof.pdf',
          mimeType: 'application/pdf',
          fileSize: 3,
          isUploaded: true,
        ),
        TrainingEvidence(
          id: 'photo',
          trainingSessionId: 'session',
          trainingSessionTopicId: 'session-topic',
          evidenceType: TrainingEvidenceType.topicPhoto,
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          fileSize: 3,
          isUploaded: uploaded,
        ),
      ];
      final c = uiController(repository, topics: [topic], evidence: photos)
        ..selectedCategory = requiredHk;
      repository.remote = TrainingSession(
        id: 'session',
        status: TrainingSessionStatus.draft,
        category: requiredHk,
        trainingType: testType,
        trainerName: 'Trainer',
        storeId: 'store',
        requireAttendeeSnapshot: false,
        topicEvidencePolicySnapshot: 'required',
        selectedTopics: [topic],
        evidence: photos,
      );
      c.session = repository.remote;
      await tester.pumpWidget(
        MaterialApp(home: HkTrainingScreen(controller: c)),
      );
      await tester.ensureVisible(find.text('Submit'));
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(repository.submitted, uploaded);
      expect(
        find.textContaining(
          uploaded
              ? 'Training submitted successfully.'
              : 'Upload a JPEG/PNG photo for every selected topic',
        ),
        findsOneWidget,
      );
    });
  }
  testWidgets(
    'new HK shows one page, one Submit, defaults, and no wizard or Technical selector',
    (tester) async {
      final c = uiController(TrainingUiFakeRepository())
        ..session = null
        ..selectedCategory = hk;
      await tester.pumpWidget(
        MaterialApp(home: HkTrainingScreen(controller: c)),
      );
      expect(find.text('HK Training'), findsOneWidget);
      expect(find.text('Submit'), findsOneWidget);
      expect(find.byType(TrainingStepper), findsNothing);
      expect(find.text('Technical / MEP'), findsNothing);
      expect(find.text('Trainer'), findsWidgets);
      expect(find.text('2026-09-29'), findsOneWidget);
      expect(find.text('Housekeeping Basics'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'missing completion proof cannot submit even with valid details/topics',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = TrainingUiFakeRepository();
      final c = uiController(repository, topics: const [])
        ..selectedCategory = hk;
      await tester.pumpWidget(
        MaterialApp(home: HkTrainingScreen(controller: c)),
      );
      await tester.tap(find.text('Housekeeping Basics'));
      await tester.ensureVisible(find.text('Submit'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Select one completion proof'),
        findsOneWidget,
      );
      expect(repository.submitted, isFalse);
    },
  );

  testWidgets(
    'incompatible new HK master fails closed without modifying policies',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = TrainingUiFakeRepository();
      final c = uiController(repository)
        ..session = null; // Existing fixture requires attendees.
      await tester.pumpWidget(
        MaterialApp(home: HkTrainingScreen(controller: c)),
      );
      expect(
        find.textContaining('HK master policy is incompatible'),
        findsOneWidget,
      );
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);
      expect(c.selectedCategory!.requireAttendee, isTrue);
    },
  );

  testWidgets('completed HK is view-only and has no Submit or upload action', (
    tester,
  ) async {
    final c = uiController(
      TrainingUiFakeRepository(),
      status: TrainingSessionStatus.submitted,
    );
    await tester.pumpWidget(MaterialApp(home: HkTrainingScreen(controller: c)));
    expect(find.text('Submit'), findsNothing);
    expect(find.textContaining('Read only'), findsOneWidget);
    final upload = tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Choose completion proof'),
    );
    expect(upload.onPressed, isNull);
  });

  test(
    'new policy marker survives parsing and copy while legacy remains unmarked',
    () {
      final session = TrainingSession.fromJson({
        'session': {
          'id': 's',
          'status': 'draft',
          'hk_training_policy': 'hk_single_page_v1',
        },
      });
      expect(session.copyWith().hkTrainingPolicy, 'hk_single_page_v1');
      expect(uiSession().hkTrainingPolicy, isNull);
    },
  );

  testWidgets(
    'rapid repeated Submit cannot overlap; successful submission becomes read-only',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = SlowSubmitRepository();
      const proof = TrainingEvidence(
        id: 'proof',
        trainingSessionId: 'session',
        evidenceType: TrainingEvidenceType.additionalDocument,
        fileName: 'proof.pdf',
        mimeType: 'application/pdf',
        fileSize: 3,
        isUploaded: true,
      );
      const topic = TrainingSessionTopic(
        id: 'selected',
        trainingSessionId: 'session',
        topicId: 'topic',
        topic: testTopic,
        isCovered: true,
      );
      final c = uiController(repository, topics: [topic], evidence: [proof])
        ..selectedCategory = hk;
      repository.remote = TrainingSession(
        id: 'session',
        status: TrainingSessionStatus.draft,
        hkTrainingPolicy: 'hk_single_page_v1',
        category: hk,
        trainingType: testType,
        trainerName: 'Trainer',
        storeId: 'store',
        selectedTopics: [topic],
        evidence: [proof],
      );
      c.session = repository.remote;
      await tester.pumpWidget(
        MaterialApp(home: HkTrainingScreen(controller: c)),
      );
      await tester.tap(find.text('Submit'));
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Submit'));
      await tester.pump(const Duration(milliseconds: 200));
      expect(repository.submissions, 1);
      repository.completion.complete();
      await tester.pumpAndSettle();
      expect(find.text('Submit'), findsNothing);
      expect(find.text('Training submitted successfully.'), findsOneWidget);
    },
  );
}
