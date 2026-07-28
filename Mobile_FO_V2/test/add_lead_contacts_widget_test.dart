import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/bd/add_lead_screen.dart';
import 'package:myqpms_fo_v2/bd/lead_details_screen.dart';
import 'package:myqpms_fo_v2/models/bd_lead_models.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/services/bd_lead_service.dart';

void main() {
  FoUser user(String role) => FoUser(
    authUserId: 'auth-$role',
    employeeCode: 'QPMS-$role',
    fullName: '$role User',
    mobile: '',
    email: '${role.replaceAll(' ', '.').toLowerCase()}@qpms.test',
    state: 'Tamil Nadu',
    role: role,
  );

  Widget app({
    BdLeadCreator? createLead,
    String role = 'BD Executive',
    BdLeadAssigneeLoader? loadAssignees,
  }) => MaterialApp(
    home: Scaffold(
      body: AddLeadScreen(
        user: user(role),
        onCreated: (_) async {},
        createLead: createLead,
        loadAssignees: loadAssignees,
      ),
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

  Future<void> fillValidLead(WidgetTester tester) async {
    await tester.enterText(
      find.widgetWithText(TextField, 'Client / Company Name *'),
      'Example Client',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Site Location *'),
      'Example Site',
    );
    await tester.enterText(find.widgetWithText(TextField, 'City *'), 'Chennai');
    await scrollTo(tester, find.byType(DropdownButtonFormField<String>).first);
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
  }

  Future<void> submitLead(WidgetTester tester) async {
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

  testWidgets('BD Executive sees self-assignment message without dropdown', (
    tester,
  ) async {
    await tester.pumpWidget(app());

    expect(find.text('This lead will be assigned to you.'), findsOneWidget);
    expect(find.byKey(const ValueKey('bd-assignee-dropdown')), findsNothing);
  });

  testWidgets('management sees active BD assignee dropdown and Unassigned', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(
        role: 'Admin',
        loadAssignees: () async => const [
          BdLeadAssignee(
            id: 'profile-bd-1',
            employeeCode: 'QPMSBD001',
            fullName: 'Active Executive',
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const ValueKey('bd-assignee-dropdown')));

    expect(find.text('This lead will be assigned to you.'), findsNothing);
    expect(find.byKey(const ValueKey('bd-assignee-dropdown')), findsOneWidget);
    expect(find.text('Unassigned'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('bd-assignee-dropdown')));
    await tester.pumpAndSettle();
    expect(find.text('Active Executive — QPMSBD001'), findsOneWidget);
  });

  testWidgets('failed submission preserves selected BD assignee', (
    tester,
  ) async {
    CreateBdLeadRequest? submitted;
    await tester.pumpWidget(
      app(
        role: 'Admin',
        loadAssignees: () async => const [
          BdLeadAssignee(
            id: 'profile-bd-1',
            employeeCode: 'QPMSBD001',
            fullName: 'Active Executive',
          ),
        ],
        createLead:
            (
              request, {
              duplicateOverride = false,
              duplicateOverrideReason = '',
            }) async {
              submitted = request;
              throw const BdLeadApiException('Unable to save lead.');
            },
      ),
    );
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const ValueKey('bd-assignee-dropdown')));
    await tester.tap(find.byKey(const ValueKey('bd-assignee-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Active Executive — QPMSBD001').last);
    await tester.pumpAndSettle();
    await fillValidLead(tester);
    await submitLead(tester);

    expect(submitted?.assignedBdProfileId, 'profile-bd-1');
    expect(find.text('Active Executive — QPMSBD001'), findsOneWidget);
  });

  testWidgets('successful submission clears selected BD assignee', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(
        role: 'Admin',
        loadAssignees: () async => const [
          BdLeadAssignee(
            id: 'profile-bd-1',
            employeeCode: 'QPMSBD001',
            fullName: 'Active Executive',
          ),
        ],
        createLead:
            (
              request, {
              duplicateOverride = false,
              duplicateOverrideReason = '',
            }) async =>
                const BdLead(id: 'lead-created', clientName: 'Example Client'),
      ),
    );
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const ValueKey('bd-assignee-dropdown')));
    await tester.tap(find.byKey(const ValueKey('bd-assignee-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Active Executive — QPMSBD001').last);
    await tester.pumpAndSettle();
    await fillValidLead(tester);
    await submitLead(tester);

    expect(find.text('Unassigned'), findsOneWidget);
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
