import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/bd/add_lead_screen.dart';
import 'package:myqpms_fo_v2/bd/lead_details_screen.dart';
import 'package:myqpms_fo_v2/models/bd_lead_models.dart';
import 'package:myqpms_fo_v2/services/bd_lead_service.dart';

void main() {
  Widget app({BdLeadCreator? createLead}) => MaterialApp(
    home: Scaffold(
      body: AddLeadScreen(onCreated: (_) async {}, createLead: createLead),
    ),
  );

  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      280,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pump();
  }

  testWidgets('initial form has one primary contact and can add another', (
    tester,
  ) async {
    await tester.pumpWidget(app());

    expect(find.text('Contact Person 1'), findsOneWidget);
    expect(find.text('Primary'), findsOneWidget);
    expect(find.text('Contact Person 2'), findsNothing);

    await scrollTo(tester, find.byKey(const ValueKey('add-contact')));
    await tester.tap(find.byKey(const ValueKey('add-contact')));
    await tester.pump();

    expect(find.text('Contact Person 2'), findsOneWidget);
    expect(find.text('Make Primary'), findsOneWidget);
  });

  testWidgets('making and removing primary keeps exactly one primary', (
    tester,
  ) async {
    await tester.pumpWidget(app());
    await scrollTo(tester, find.byKey(const ValueKey('add-contact')));
    await tester.tap(find.byKey(const ValueKey('add-contact')));
    await tester.pump();

    await scrollTo(tester, find.byKey(const ValueKey('make-primary-1')));
    await tester.tap(find.byKey(const ValueKey('make-primary-1')));
    await tester.pump();
    expect(find.text('Primary'), findsOneWidget);

    await scrollTo(tester, find.byKey(const ValueKey('remove-contact-1')));
    await tester.tap(find.byKey(const ValueKey('remove-contact-1')));
    await tester.pump();
    expect(find.text('Contact Person 1'), findsOneWidget);
    expect(find.text('Primary'), findsOneWidget);
  });

  testWidgets('failed submission retains entered contact values', (
    tester,
  ) async {
    var attempted = false;
    await tester.pumpWidget(
      app(
        createLead:
            (
              request, {
              duplicateOverride = false,
              duplicateOverrideReason = '',
            }) async {
              attempted = true;
              throw const BdLeadApiException('Unable to save lead.');
            },
      ),
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'Client / Company Name *'),
      'Example Client',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Site Location *'),
      'Example Site',
    );
    await tester.enterText(find.widgetWithText(TextField, 'City *'), 'Chennai');
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Commercial').last);
    await tester.pumpAndSettle();

    await scrollTo(tester, find.byKey(const ValueKey('contact-name-0')));
    await tester.enterText(
      find.byKey(const ValueKey('contact-name-0')),
      'Retained Contact',
    );
    await tester.enterText(
      find.byKey(const ValueKey('contact-email-0')),
      'retained@example.com',
    );
    await scrollTo(tester, find.byKey(const ValueKey('create-lead')));
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -120));
    await tester.pump();
    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey('create-lead')),
        matching: find.byType(FilledButton),
      ),
    );
    await tester.pumpAndSettle();

    expect(attempted, isTrue);
    expect(find.text('Retained Contact'), findsOneWidget);
  });

  testWidgets('lead details displays every contact with primary first', (
    tester,
  ) async {
    final lead = BdLead(
      id: 'lead-1',
      clientName: 'Example Client',
      contacts: const [
        BdLeadContact(name: 'Secondary', phone: '9000000002'),
        BdLeadContact(
          name: 'Primary',
          email: 'primary@example.com',
          isPrimary: true,
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: LeadDetailsScreen(initialLead: lead, onChanged: () {}),
      ),
    );
    await tester.pump();

    await tester.scrollUntilVisible(
      find.text('Contact Person 2'),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Primary'), findsWidgets);
    expect(find.text('Secondary'), findsOneWidget);
    expect(find.text('Contact Person 1'), findsOneWidget);
    expect(find.text('Contact Person 2'), findsOneWidget);
  });

  testWidgets('successful submission resets to one empty primary contact', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(
        createLead:
            (
              request, {
              duplicateOverride = false,
              duplicateOverrideReason = '',
            }) async =>
                const BdLead(id: 'lead-created', clientName: 'Example Client'),
      ),
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'Client / Company Name *'),
      'Example Client',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Site Location *'),
      'Example Site',
    );
    await tester.enterText(find.widgetWithText(TextField, 'City *'), 'Chennai');
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Commercial').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const ValueKey('contact-name-0')));
    await tester.enterText(
      find.byKey(const ValueKey('contact-name-0')),
      'Primary Contact',
    );
    await tester.enterText(
      find.byKey(const ValueKey('contact-phone-0')),
      '9000000001',
    );
    await scrollTo(tester, find.byKey(const ValueKey('create-lead')));
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -120));
    await tester.pump();
    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey('create-lead')),
        matching: find.byType(FilledButton),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Contact Person 1'), findsOneWidget);
    expect(find.text('Contact Person 2'), findsNothing);
    expect(find.text('Primary'), findsOneWidget);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('contact-name-0')))
          .controller
          ?.text,
      isEmpty,
    );
  });
}
