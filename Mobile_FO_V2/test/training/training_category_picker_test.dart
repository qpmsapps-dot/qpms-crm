import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/training_launcher.dart';

void main() {
  const hk = TrainingCategory(id: 'hk', code: 'hk', name: 'HK Training');
  const mepc = TrainingCategory(
    id: 'mepc',
    code: 'technical_mep',
    name: 'MEPC Training',
  );
  const inactive = TrainingCategory(
    id: 'inactive',
    code: 'inactive',
    name: 'Inactive',
    isActive: false,
  );

  for (final categories in <List<TrainingCategory>>[
    [hk],
    [mepc],
    [hk, mepc],
    [],
  ]) {
    testWidgets(
      'FO picker shows only server-entitled categories: ${categories.map((c) => c.code).join(',')}',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => TextButton(
                onPressed: () => selectNewTrainingCategory(context, categories),
                child: const Text('Choose category'),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Choose category'));
        await tester.pumpAndSettle();
        expect(
          find.text('HK Training'),
          categories.contains(hk) ? findsOneWidget : findsNothing,
        );
        expect(
          find.text('MEPC Training'),
          categories.contains(mepc) ? findsOneWidget : findsNothing,
        );
      },
    );
  }

  for (final category in [hk, mepc]) {
    testWidgets('new Training can select ${category.code}', (tester) async {
      TrainingCategory? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return TextButton(
                onPressed: () async {
                  selected = await selectNewTrainingCategory(context, [
                    hk,
                    mepc,
                    inactive,
                  ]);
                },
                child: const Text('Open'),
              );
            },
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      expect(find.text('HK Training'), findsOneWidget);
      expect(find.text('MEPC Training'), findsOneWidget);
      expect(find.text('Inactive'), findsNothing);
      await tester.tap(find.text(category.name));
      await tester.pumpAndSettle();
      expect(selected, category);
    });
  }

  testWidgets('dismissing category selection does not default to HK', (
    tester,
  ) async {
    TrainingCategory? selected;
    var completed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return TextButton(
              onPressed: () async {
                selected = await selectNewTrainingCategory(context, [hk, mepc]);
                completed = true;
              },
              child: const Text('Open'),
            );
          },
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(5, 5));
    await tester.pumpAndSettle();
    expect(completed, isTrue);
    expect(selected, isNull);
  });
}
