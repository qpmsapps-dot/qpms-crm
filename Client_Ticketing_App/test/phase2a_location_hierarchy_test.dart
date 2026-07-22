import 'dart:io';

import 'package:client_ticketing_app/data/mock_data.dart';
import 'package:client_ticketing_app/models/hospital_location_models.dart';
import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('hierarchy models tolerate old and new response shapes', () {
    final location = HospitalLocation.fromJson(const {
      'id': 'loc-1',
      'block_id': 'block-1',
      'floor_id': null,
      'department_id': 'dept-1',
      'location_name': 'Room 503',
      'room_number': '503',
      'area_name': '',
      'verification_status': 'draft',
    });

    expect(location.floorId, isEmpty);
    expect(location.displayName, '503 / Room 503');
  });

  test('controller keeps departments without confirmed floors accessible', () {
    final controller = TicketController(demoMode: false)
      ..replaceMastersForTesting(
        blocks: const [
          {'id': 'b1', 'block_name': 'Speciality Block', 'is_active': true},
        ],
        floors: const [
          {
            'id': 'f5',
            'block_id': 'b1',
            'floor_name': 'Fifth Floor',
            'is_active': true,
          },
        ],
        departments: const [
          {
            'id': 'd1',
            'block_id': 'b1',
            'floor_id': 'f5',
            'department_name': 'Surgical Gastroenterology',
            'is_active': true,
          },
          {
            'id': 'd2',
            'block_id': 'b1',
            'floor_id': '',
            'department_name': 'Unconfirmed Floor Unit',
            'is_active': true,
          },
        ],
        locations: const [
          {
            'id': 'l1',
            'block_id': 'b1',
            'floor_id': 'f5',
            'department_id': 'd1',
            'location_name': 'Room 503',
            'room_number': '503',
            'is_active': true,
          },
        ],
      );

    expect(
      controller
          .departmentsFor(blockId: 'b1', floorId: 'f5')
          .map((row) => row.name),
      containsAll(['Surgical Gastroenterology', 'Unconfirmed Floor Unit']),
    );
  });

  test('inactive and rejected hierarchy records are not selectable', () {
    final controller = TicketController(demoMode: false)
      ..replaceMastersForTesting(
        blocks: const [
          {'id': 'ok', 'block_name': 'OPD Block', 'is_active': true},
          {
            'id': 'bad',
            'block_name': 'Trauma Block',
            'is_active': true,
            'verification_status': 'rejected',
          },
        ],
        locations: const [],
      );

    expect(controller.hospitalBlocks.map((row) => row.name), ['OPD Block']);
  });

  test(
    'exact landmark can satisfy location identity when no room is selected',
    () {
      final controller = TicketController(demoMode: true);
      final draft = ComplaintDraft(
        block: 'Core Block',
        floor: '',
        department: 'Unconfirmed Floor Unit',
        location: '',
        exactLandmark: 'Corridor outside CTICU',
        category: 'Washroom Cleaning',
        description: 'Wet floor',
      )..departmentId = 'd2';

      expect(controller.isDraftValid(draft), isTrue);
      expect(
        controller.buildLocationSummary(draft),
        contains('Corridor outside CTICU'),
      );
    },
  );

  test('landmark-only draft does not require a fake floor or room', () {
    final controller = TicketController(demoMode: false)
      ..replaceMastersForTesting(
        blocks: const [
          {'id': 'b1', 'block_name': 'Core Block', 'is_active': true},
        ],
        departments: const [
          {
            'id': 'd1',
            'block_id': 'b1',
            'floor_id': '',
            'department_name': 'Unconfirmed Floor Unit',
            'is_active': true,
          },
        ],
        categories: const [
          {'id': 'c1', 'category_name': 'Housekeeping', 'is_active': true},
        ],
        locations: const [
          {
            'id': 'l1',
            'block_id': 'b1',
            'floor_id': 'f1',
            'department_id': 'other',
            'location_name': 'Room 101',
            'is_active': true,
          },
        ],
      );

    final draft =
        ComplaintDraft(
            block: 'Core Block',
            department: 'Unconfirmed Floor Unit',
            location: '',
            exactLandmark: 'Washroom beside main department entrance',
            category: 'Housekeeping',
            description: 'Needs cleaning',
          )
          ..blockId = 'b1'
          ..departmentId = 'd1';

    expect(controller.isDraftValid(draft), isTrue);
    expect(controller.buildLocationSummary(draft), isNot(contains('null')));
    expect(controller.buildLocationSummary(draft), contains('Washroom beside'));
  });

  test('Flutter create mapping can send nullable location id', () {
    final controllerSource = File(
      'lib/state/ticket_controller.dart',
    ).readAsStringSync();

    expect(
      controllerSource,
      contains("'location_id': location == null ? null"),
    );
    expect(controllerSource, contains("'department_id': draft.departmentId"));
    expect(controllerSource, contains("'exact_landmark': draft.exactLandmark"));
  });

  test('ticket details prefer immutable snapshot fields', () {
    final ticket = Ticket.fromApi(const {
      'id': 'ticket-1',
      'ticket_no': 'QPMS-HK-2026-9999',
      'site_name_snapshot': 'NIMS Hyderabad',
      'block_name_snapshot': 'Speciality Block',
      'floor_name': 'Fifth Floor',
      'department_name': 'Surgical Gastroenterology',
      'room_area_snapshot': 'Room 503',
      'exact_landmark_snapshot': 'Corridor outside Room 503',
      'location_path_snapshot':
          'NIMS Hyderabad > Speciality Block > Fifth Floor > Surgical Gastroenterology > Room 503 > Corridor outside Room 503',
      'location_text': 'Room 503',
      'category': {'category_name': 'Housekeeping'},
      'priority': 'medium',
      'description': 'Test',
      'status_code': 'open',
    });

    expect(ticket.detailLocation, startsWith('NIMS Hyderabad'));
    expect(ticket.detailLocation, contains('Corridor outside Room 503'));
    expect(ticket.conciseLocation, contains('Room 503'));
  });

  test('demo hierarchy remains isolated from live backend endpoints', () {
    expect(demoBlockRows, isNotEmpty);
    expect(demoFloorRows, isNotEmpty);
    expect(demoDepartmentRows, isNotEmpty);
    expect(demoLocationRows, isNotEmpty);

    final api = File(
      'lib/services/hospital_ticket_api.dart',
    ).readAsStringSync();
    expect(api, contains('/api/hospital-tickets/floors'));
    expect(api, contains('/api/hospital-tickets/hierarchy/locations'));
  });
}
