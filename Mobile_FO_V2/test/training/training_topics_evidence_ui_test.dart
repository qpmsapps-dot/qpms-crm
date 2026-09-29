import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/screens/training_evidence_step.dart';
import 'package:myqpms_fo_v2/training/screens/training_topics_step.dart';

import 'training_ui_test_support.dart';

Widget shell(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('Topics filters, selects, unselects and reports empty search', (
    tester,
  ) async {
    final repository = TrainingUiFakeRepository();
    final controller = uiController(repository);
    await tester.pumpWidget(shell(TrainingTopicsStep(controller: controller)));
    expect(find.text('Housekeeping Basics'), findsOneWidget);
    expect(find.text('0 Topics Selected'), findsOneWidget);
    await tester.tap(find.text('Housekeeping Basics'));
    await tester.pump();
    expect(controller.selectedTopicCount, 1);
    expect(find.text('1 Topics Selected'), findsOneWidget);
    await tester.tap(find.text('Housekeeping Basics'));
    await tester.pump();
    expect(controller.selectedTopicCount, 0);
    await tester.enterText(
      find.byKey(const Key('topic-search-field')),
      'missing',
    );
    await tester.pump();
    expect(find.text('No topics match your search.'), findsOneWidget);
  });

  testWidgets('Evidence-linked selected topic is visibly locked', (
    tester,
  ) async {
    const sessionTopic = TrainingSessionTopic(
      id: 'session-topic',
      trainingSessionId: 'session',
      topicId: 'topic',
      topic: testTopic,
    );
    const evidence = TrainingEvidence(
      id: 'evidence',
      trainingSessionId: 'session',
      trainingSessionTopicId: 'session-topic',
      evidenceType: TrainingEvidenceType.topicPhoto,
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2,
    );
    final controller = uiController(
      TrainingUiFakeRepository(),
      topics: [sessionTopic],
      evidence: [evidence],
    );
    await tester.pumpWidget(shell(TrainingTopicsStep(controller: controller)));
    expect(find.text('Remove evidence before deselecting'), findsOneWidget);
  });

  testWidgets(
    'Evidence shows progress, topic actions and supporting proof cards',
    (tester) async {
      const covered = TrainingSessionTopic(
        id: 'session-topic',
        trainingSessionId: 'session',
        topicId: 'topic',
        topic: testTopic,
        isCovered: true,
        remarks: 'Covered fully',
      );
      var picks = 0;
      final controller = uiController(
        TrainingUiFakeRepository(),
        topics: [covered],
      );
      await tester.pumpWidget(
        shell(
          TrainingEvidenceStep(
            controller: controller,
            evidencePicker: (_, _) async {
              picks++;
            },
          ),
        ),
      );
      expect(find.text('1 of 1 topics completed'), findsOneWidget);
      expect(find.text('100%'), findsOneWidget);
      expect(find.text('Covered'), findsOneWidget);
      expect(find.text('Group Training Photos'), findsOneWidget);
      await tester.tap(find.text('Add Photo'));
      await tester.pump();
      expect(picks, 1);
      await tester.tap(find.text('Remarks'));
      await tester.pumpAndSettle();
      expect(find.text('Topic Remarks'), findsOneWidget);
      await tester.tap(find.text('Save Remarks'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Attendance Sheet'),
        250,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Attendance Sheet'), findsOneWidget);
      expect(find.text('Training Document'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Additional Documents'),
        250,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Additional Documents'), findsOneWidget);
    },
  );

  testWidgets('Evidence displays failed queue state with retry action', (
    tester,
  ) async {
    final controller = uiController(TrainingUiFakeRepository());
    controller.pendingEvidence = [
      TrainingPendingEvidence(
        localId: 'local',
        sessionId: 'session',
        evidenceType: TrainingEvidenceType.groupPhoto,
        localFilePath: 'missing.jpg',
        fileName: 'missing.jpg',
        mimeType: 'image/jpeg',
        fileSize: 10,
        state: TrainingUploadState.failed,
        retryable: true,
        retryCount: 1,
        lastError: 'temporary',
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      ),
    ];
    await tester.pumpWidget(
      shell(
        TrainingEvidenceStep(
          controller: controller,
          evidencePicker: (_, _) async {},
        ),
      ),
    );
    expect(find.text('Pending Uploads'), findsOneWidget);
    expect(find.text('failed'), findsOneWidget);
    expect(find.byTooltip('Retry upload'), findsOneWidget);
    expect(find.byTooltip('Remove pending upload'), findsOneWidget);
  });
}
