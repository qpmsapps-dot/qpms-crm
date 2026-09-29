import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/screens/training_attendees_step.dart';
import 'package:myqpms_fo_v2/training/screens/training_details_step.dart';
import 'package:myqpms_fo_v2/training/state/training_flow_controller.dart';
import 'package:myqpms_fo_v2/training/widgets/training_site_context.dart';

import 'training_ui_test_support.dart';

Widget shell(Widget child) => MaterialApp(home: Scaffold(body: child));

Widget observed(TrainingFlowController controller, Widget Function() child) =>
    MaterialApp(
      home: Scaffold(
        body: AnimatedBuilder(
          animation: controller,
          builder: (_, _) => child(),
        ),
      ),
    );

void main() {
  testWidgets(
    'Details renders real context, categories, types and remarks counter',
    (tester) async {
      final repository = TrainingUiFakeRepository();
      final controller = uiController(repository);
      await tester.pumpWidget(
        shell(
          TrainingDetailsStep(
            controller: controller,
            siteContext: TrainingSiteDisplayContext(
              siteName: 'Reliance Retail Bengaluru',
              state: 'KA',
              business: 'Reliance Retail',
              checkedIn: true,
              checkInTime: DateTime(2026, 9, 29, 14, 40),
            ),
          ),
        ),
      );
      expect(find.text('Site Information'), findsOneWidget);
      expect(find.text('Reliance Retail Bengaluru'), findsOneWidget);
      expect(find.text('Housekeeping (HK)'), findsOneWidget);
      expect(find.text('Technical / MEP'), findsOneWidget);
      expect(find.text('Toolbox'), findsOneWidget);
      expect(find.textContaining('0/500'), findsOneWidget);
      await tester.tap(find.text('Technical / MEP'));
      await tester.pump();
      expect(controller.selectedCategory?.id, 'technical');
      await tester.drag(find.byType(ListView), const Offset(0, -350));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Classroom'));
      await tester.pump();
      expect(controller.selectedTrainingType?.code, 'classroom');
    },
  );

  testWidgets('Details remains overflow-free at approved Android widths', (
    tester,
  ) async {
    for (final width in [360.0, 375.0, 390.0, 411.0]) {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      final controller = uiController(TrainingUiFakeRepository());
      await tester.pumpWidget(
        shell(
          TrainingDetailsStep(
            controller: controller,
            siteContext: const TrainingSiteDisplayContext(
              siteName:
                  'A very long Reliance Retail store name that must wrap safely',
              state: 'Karnataka',
              business: 'Reliance Retail',
              checkedIn: true,
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    }
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  });

  testWidgets(
    'Attendees supports debounced search, add, duplicate state and remove',
    (tester) async {
      final repository = TrainingUiFakeRepository();
      final controller = uiController(repository);
      await tester.pumpWidget(
        observed(
          controller,
          () => TrainingAttendeesStep(controller: controller),
        ),
      );
      expect(find.text('0 Staff Added'), findsOneWidget);
      expect(find.text('No attendees added yet.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('staff-search-field')),
        'EMP01',
      );
      await tester.pump(const Duration(milliseconds: 399));
      expect(find.text('Asha Kumar'), findsNothing);
      await tester.pump(const Duration(milliseconds: 2));
      await tester.pumpAndSettle();
      expect(find.text('Asha Kumar'), findsOneWidget);
      await tester.tap(find.text('Add'));
      await tester.pump();
      expect(controller.attendeeCount, 1);
      expect(find.text('1 Staff Added'), findsOneWidget);
      expect(find.text('Added'), findsOneWidget);
      await tester.tap(find.text('Remove'));
      await tester.pump();
      expect(controller.attendeeCount, 0);
    },
  );
}
