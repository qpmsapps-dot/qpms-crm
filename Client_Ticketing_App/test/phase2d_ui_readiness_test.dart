import 'dart:io';

import 'package:client_ticketing_app/core/utils/friendly_errors.dart';
import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/services/hospital_ticket_api.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('splash and login render the QPMS logo asset', () {
    final splash = File(
      'lib/features/splash/splash_screen.dart',
    ).readAsStringSync();
    final login = File(
      'lib/features/auth/login_screen.dart',
    ).readAsStringSync();
    final assets = File(
      'lib/core/constants/app_assets.dart',
    ).readAsStringSync();

    expect(assets, contains('assets/branding/qpms-logo.png'));
    expect(splash, contains('LogoMark'));
    expect(login, contains('LogoMark'));
  });

  test('bottom navigation exposes the approved primary destinations', () {
    final nav = File(
      'lib/core/widgets/client_bottom_nav.dart',
    ).readAsStringSync();

    for (final label in ['Home', 'Complaints', 'Notifications', 'Profile']) {
      expect(nav, contains(label));
    }
  });

  test('complaints filters include all requested states', () {
    expect(
      TicketListFilter.values.map((filter) => filter.name),
      containsAll([
        'all',
        'open',
        'assigned',
        'inProgress',
        'awaitingConfirmation',
        'resolved',
        'closed',
        'reopened',
      ]),
    );
  });

  test(
    'raise complaint screen has dynamic wizard steps with discard guard',
    () {
      final source = File(
        'lib/features/raise_ticket/raise_ticket_screen.dart',
      ).readAsStringSync();

      expect(source, contains('enum _ComplaintStep'));
      expect(source, contains('List<_ComplaintStep> _stepsFor'));
      expect(source, contains('Step \${step + 1} of \$totalSteps'));
      expect(source, contains('Select Block'));
      expect(source, contains('Select Floor'));
      expect(source, contains('Select Department / Location'));
      expect(source, contains('Select Location'));
      expect(source, contains('Exact Landmark'));
      expect(source, contains('Complaint Category'));
      expect(source, contains('Priority'));
      expect(source, contains('Add Details and Photos'));
      expect(source, contains('Review and Submit'));
      expect(source, contains('Discard complaint?'));
    },
  );

  test('parent hierarchy changes reset child selections', () {
    final source = File(
      'lib/features/raise_ticket/raise_ticket_screen.dart',
    ).readAsStringSync();

    expect(source, contains('..floorId ='));
    expect(source, contains('..departmentId ='));
    expect(source, contains('..locationId ='));
    expect(source, contains('await controller.loadFloorsForBlock(blockId)'));
    expect(
      source,
      contains('await controller.loadDepartmentsForBlock(blockId)'),
    );
  });

  test('review screen and double-submit protection remain present', () {
    final source = File(
      'lib/features/raise_ticket/raise_ticket_screen.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/state/ticket_controller.dart',
    ).readAsStringSync();

    expect(source, contains('Review and Submit'));
    expect(source, contains('photoCount'));
    expect(source, contains('_submitting'));
    expect(controller, contains('idempotencyKey'));
    expect(controller, contains("'Idempotency-Key': draft.idempotencyKey"));
  });

  test('star rating supports mandatory 1 to 5 selection and reopen path', () {
    final source = File(
      'lib/features/tickets/feedback_screen.dart',
    ).readAsStringSync();

    expect(source, contains('How was the work completed?'));
    expect(source, contains('Rate the service'));
    expect(source, contains('Submit Rating'));
    expect(source, contains('Not Satisfied / Reopen'));
    for (final label in ['Very Poor', 'Poor', 'Average', 'Good', 'Excellent']) {
      expect(source, contains(label));
    }
    expect(source, contains('Select a rating from 1 to 5 stars.'));
  });

  test('friendly error mapping hides technical errors', () {
    expect(
      friendlyErrorMessage(
        const HospitalApiException('PostgREST RPC failed', code: 'timeout'),
        fallback: 'fallback',
      ),
      'The request took too long. Please try again.',
    );
    expect(
      friendlyErrorMessage(
        const HospitalApiException('SQLSTATE 42501 forbidden', statusCode: 500),
        fallback: 'Unable to submit the complaint. Please try again.',
      ),
      'Unable to submit the complaint. Please try again.',
    );
  });

  test('landmark-only and room-backed drafts remain valid', () {
    final controller = TicketController(demoMode: true);
    final roomBacked = ComplaintDraft(
      block: 'Block A',
      floor: '3rd Floor',
      department: 'Patient Ward',
      location: 'Staff Washroom',
      category: 'Housekeeping',
      description: 'Needs cleaning',
    );
    final landmarkOnly = ComplaintDraft(
      block: 'Block A',
      department: 'Patient Ward',
      location: '',
      exactLandmark: 'Opposite Nursing Station',
      category: 'Housekeeping',
      description: 'Needs cleaning',
    )..departmentId = 'demo-dept-ward';

    expect(controller.isDraftValid(roomBacked), isTrue);
    expect(controller.isDraftValid(landmarkOnly), isTrue);
  });

  test('client assignee redaction is covered by backend regression test', () {
    final source = File(
      '../backend/tests/hospitalTicketService.test.js',
    ).readAsStringSync();
    expect(source, contains('PHASE 2D UAT Supervisor'));
    expect(source, contains('employee_code'));
    expect(source, contains('view.assignee'));
  });
}
