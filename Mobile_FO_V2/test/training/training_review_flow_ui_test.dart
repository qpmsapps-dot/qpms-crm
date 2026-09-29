import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/models/training_attendee.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/screens/training_flow_screen.dart';
import 'package:myqpms_fo_v2/training/screens/training_review_step.dart';
import 'package:myqpms_fo_v2/training/widgets/training_site_context.dart';

import 'training_ui_test_support.dart';

Widget shell(Widget child) => MaterialApp(home: child);

const attendee = TrainingAttendee(
  id: 'attendee',
  trainingSessionId: 'session',
  profileId: 'profile',
  employeeCode: 'EMP01',
  employeeName: 'Asha Kumar',
);
const selectedTopic = TrainingSessionTopic(
  id: 'session-topic',
  trainingSessionId: 'session',
  topicId: 'topic',
  topic: testTopic,
  isCovered: true,
);

void main() {
  testWidgets(
    'Review renders metrics, summary, attendee, topic and incomplete state',
    (tester) async {
      final controller = uiController(
        TrainingUiFakeRepository(),
        attendees: [attendee],
        topics: [selectedTopic],
      );
      await tester.pumpWidget(
        shell(Scaffold(body: TrainingReviewStep(controller: controller))),
      );
      expect(find.text('Ready to Submit'), findsOneWidget);
      expect(find.text('Session Summary'), findsOneWidget);
      expect(find.text('Asha Kumar'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Housekeeping Basics'),
        250,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Housekeeping Basics'), findsOneWidget);
      expect(find.text('Evidence Uploaded'), findsOneWidget);
      controller.pendingEvidence = [];
    },
  );

  testWidgets('Flow submit confirms, waits for server and shows success', (
    tester,
  ) async {
    final repository = TrainingUiFakeRepository();
    final controller = uiController(
      repository,
      attendees: [attendee],
      topics: [selectedTopic],
    )..currentStep = TrainingFlowStep.review;
    await tester.pumpWidget(
      shell(
        TrainingFlowScreen(
          controller: controller,
          siteContext: const TrainingSiteDisplayContext(
            siteName: 'Reliance Retail Bengaluru',
            state: 'KA',
            business: 'Reliance Retail',
            checkedIn: true,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Submit Training'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Training?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
    await tester.pumpAndSettle();
    expect(repository.submitted, isTrue);
    expect(find.text('Training Submitted Successfully'), findsOneWidget);
  });

  testWidgets('Submitted and cancelled sessions expose read-only flow', (
    tester,
  ) async {
    for (final status in [
      TrainingSessionStatus.submitted,
      TrainingSessionStatus.cancelled,
    ]) {
      final controller = uiController(
        TrainingUiFakeRepository(),
        status: status,
      );
      await tester.pumpWidget(
        shell(
          TrainingFlowScreen(
            controller: controller,
            siteContext: const TrainingSiteDisplayContext(
              siteName: 'Reliance Retail Bengaluru',
            ),
          ),
        ),
      );
      expect(
        find.text(
          status == TrainingSessionStatus.submitted
              ? 'Submitted • Read only'
              : 'Cancelled • Read only',
        ),
        findsOneWidget,
      );
      expect(find.text('View Next'), findsOneWidget);
    }
  });

  testWidgets('Stepper remains usable at supported widths', (tester) async {
    for (final width in [360.0, 375.0, 390.0, 411.0]) {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      final controller = uiController(TrainingUiFakeRepository());
      await tester.pumpWidget(
        shell(
          TrainingFlowScreen(
            controller: controller,
            siteContext: const TrainingSiteDisplayContext(
              siteName: 'Reliance Retail Bengaluru',
            ),
          ),
        ),
      );
      expect(find.text('Attendees'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  });
}
