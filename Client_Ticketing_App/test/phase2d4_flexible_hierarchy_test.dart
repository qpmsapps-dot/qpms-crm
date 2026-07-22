import 'dart:io';

import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/services/hospital_ticket_api.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TicketController controllerWithFlexibleMasters() =>
      TicketController(demoMode: false)..replaceMastersForTesting(
        blocks: const [
          {'id': 'block-a', 'block_name': 'Block A', 'is_active': true},
          {'id': 'block-b', 'block_name': 'Block B', 'is_active': true},
          {
            'id': 'speciality',
            'block_name': 'Speciality Block',
            'is_active': true,
          },
        ],
        floors: const [
          {
            'id': 'floor-5',
            'block_id': 'speciality',
            'floor_name': 'Fifth Floor',
            'is_active': true,
          },
        ],
        departments: const [
          {
            'id': 'dept-sg',
            'block_id': 'speciality',
            'floor_id': 'floor-5',
            'department_name': 'Surgical Gastroenterology',
            'is_active': true,
          },
          {
            'id': 'dept-op',
            'block_id': 'speciality',
            'floor_id': '',
            'department_name': 'SPL Cardiology OP',
            'is_active': true,
          },
        ],
        locations: const [
          {
            'id': 'loc-a',
            'block_id': 'block-a',
            'floor_id': null,
            'department_id': null,
            'floor_name': '3rd Floor',
            'department_name': 'Patient Ward',
            'location_name': 'Block A UAT Ward',
            'is_active': true,
          },
          {
            'id': 'loc-b',
            'block_id': 'block-b',
            'floor_id': null,
            'department_id': null,
            'floor_name': '3rd Floor',
            'department_name': 'Patient Ward',
            'location_name': 'Block B UAT Ward',
            'is_active': true,
          },
          {
            'id': 'room-503',
            'block_id': 'speciality',
            'floor_id': 'floor-5',
            'department_id': 'dept-sg',
            'floor_name': 'Fifth Floor',
            'department_name': 'Surgical Gastroenterology',
            'location_name': 'Room 503',
            'room_number': '503',
            'is_active': true,
          },
        ],
        categories: const [
          {
            'id': 'cat-general',
            'category_name': 'General Housekeeping',
            'is_active': true,
          },
        ],
      );

  test('complaint draft starts without stale Housekeeping category', () {
    expect(ComplaintDraft().category, isEmpty);
  });

  test('Block A flattened hierarchy prepares a valid create payload', () {
    final controller = controllerWithFlexibleMasters();
    final draft =
        ComplaintDraft(
            block: 'Block A',
            floor: '',
            department: '',
            location: 'Block A UAT Ward',
            exactLandmark: 'Near Nursing Station',
            category: 'General Housekeeping',
            priority: TicketPriority.medium,
            description: 'INTERNAL UAT - SAFE TO CANCEL - test issue',
          )
          ..blockId = 'block-a'
          ..locationId = 'loc-a';

    expect(controller.isDraftValid(draft), isTrue);
    final payload = controller.createPayloadForTesting(draft);
    expect(payload['block_id'], 'block-a');
    expect(payload['floor_id'], isNull);
    expect(payload['department_id'], isNull);
    expect(payload['location_id'], 'loc-a');
    expect(payload['category_id'], 'cat-general');
    expect(payload['exact_landmark'], 'Near Nursing Station');
  });

  test('Block B flattened hierarchy prepares a valid create payload', () {
    final controller = controllerWithFlexibleMasters();
    final draft =
        ComplaintDraft(
            block: 'Block B',
            location: 'Block B UAT Ward',
            category: 'General Housekeeping',
            priority: TicketPriority.high,
            description: 'INTERNAL UAT - SAFE TO CANCEL - test issue',
          )
          ..blockId = 'block-b'
          ..locationId = 'loc-b';

    final payload = controller.createPayloadForTesting(draft);
    expect(payload['block_id'], 'block-b');
    expect(payload['floor_id'], isNull);
    expect(payload['department_id'], isNull);
    expect(payload['location_id'], 'loc-b');
  });

  test('full room-backed NIMS hierarchy remains compatible', () {
    final controller = controllerWithFlexibleMasters();
    final draft =
        ComplaintDraft(
            block: 'Speciality Block',
            floor: 'Fifth Floor',
            department: 'Surgical Gastroenterology',
            location: 'Room 503',
            category: 'General Housekeeping',
            description: 'Room needs attention',
          )
          ..blockId = 'speciality'
          ..floorId = 'floor-5'
          ..departmentId = 'dept-sg'
          ..locationId = 'room-503';

    final payload = controller.createPayloadForTesting(draft);
    expect(payload['floor_id'], 'floor-5');
    expect(payload['department_id'], 'dept-sg');
    expect(payload['location_id'], 'room-503');
  });

  test('landmark-only department hierarchy remains compatible', () {
    final controller = controllerWithFlexibleMasters();
    final draft =
        ComplaintDraft(
            block: 'Speciality Block',
            department: 'SPL Cardiology OP',
            location: '',
            exactLandmark: 'Opposite Nursing Station',
            category: 'General Housekeeping',
            description: 'Needs cleaning',
          )
          ..blockId = 'speciality'
          ..departmentId = 'dept-op';

    expect(controller.isDraftValid(draft), isTrue);
    final payload = controller.createPayloadForTesting(draft);
    expect(payload['floor_id'], isNull);
    expect(payload['department_id'], 'dept-op');
    expect(payload['location_id'], isNull);
    expect(payload['exact_landmark'], 'Opposite Nursing Station');
  });

  test('invalid category uses friendly category message', () {
    final controller = controllerWithFlexibleMasters();
    final draft =
        ComplaintDraft(
            block: 'Block A',
            location: 'Block A UAT Ward',
            category: 'Housekeeping',
            description: 'Test issue',
          )
          ..blockId = 'block-a'
          ..locationId = 'loc-a';

    expect(
      () => controller.createPayloadForTesting(draft),
      throwsA(
        isA<HospitalApiException>().having(
          (error) => error.message,
          'message',
          'Please select a complaint category.',
        ),
      ),
    );
  });

  test(
    'scope filtering remains represented by block-local location selection',
    () {
      final controller = controllerWithFlexibleMasters();
      expect(controller.locationsFor(blockId: 'block-a').map((row) => row.id), [
        'loc-a',
      ]);
      expect(controller.locationsFor(blockId: 'block-b').map((row) => row.id), [
        'loc-b',
      ]);
    },
  );

  test('wizard source supports dynamic steps and idempotency header', () {
    final screen = File(
      'lib/features/raise_ticket/raise_ticket_screen.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/state/ticket_controller.dart',
    ).readAsStringSync();

    expect(screen, contains('enum _ComplaintStep'));
    expect(screen, contains('Step \${step + 1} of \$totalSteps'));
    expect(screen, contains('No locations are available for this block.'));
    expect(
      controller,
      contains("headers: {'Idempotency-Key': draft.idempotencyKey}"),
    );
  });
}
