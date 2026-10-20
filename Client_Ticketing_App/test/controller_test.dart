import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/state/auth_controller.dart';
import 'package:client_ticketing_app/state/notification_controller.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:client_ticketing_app/services/hospital_ticket_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('demo login remains available for the frontend prototype', () async {
    final auth = AuthController(demoMode: true);
    expect(await auth.login('admin', 'admin'), isTrue);
    expect(auth.isAuthenticated, isTrue);
  });

  test('login rejects incorrect credentials', () async {
    final auth = AuthController(demoMode: true);
    expect(await auth.login('admin', 'wrong'), isFalse);
    expect(auth.isAuthenticated, isFalse);
  });

  test('complaint validation requires a description', () {
    final controller = TicketController(demoMode: true);
    expect(
      controller.isDraftValid(
        ComplaintDraft(category: 'Housekeeping', description: ''),
      ),
      isFalse,
    );
    expect(
      controller.isDraftValid(
        ComplaintDraft(
            category: 'Housekeeping',
            description: 'Bathroom not cleaned properly.',
          )
          ..blockId = 'block-a'
          ..block = 'Block A'
          ..floorId = 'floor-a'
          ..floor = '3rd Floor'
          ..locationId = 'location-a'
          ..location = 'Ward A',
      ),
      isTrue,
    );
  });

  test('submission generates a unique open housekeeping ticket', () async {
    final controller = TicketController(demoMode: true);
    final now = DateTime(2026, 7, 16, 10, 30);
    final ticket = await controller.submitComplaint(
      ComplaintDraft(
        block: 'Block A',
        floor: '3rd Floor',
        location: 'Nurse Station',
        category: 'Washroom Cleaning',
        priority: TicketPriority.high,
        description: 'Bathroom not cleaned properly near nurse station.',
      ),
      now: now,
    );

    expect(ticket.number, 'QPMS-HK-2026-0006');
    expect(ticket.status, TicketStatus.open);
    expect(ticket.assignedRole, 'Housekeeping Supervisor');
    expect(ticket.slaLabel, contains('20 minutes'));
    expect(controller.tickets.first.number, ticket.number);
  });

  test(
    'create payload retains hierarchy ids and critical priority mapping',
    () {
      final controller = TicketController(demoMode: false);
      controller.replaceMastersForTesting(
        blocks: const [
          {
            'id': '11111111-1111-4111-8111-111111111111',
            'block_name': 'Block A',
            'is_active': true,
          },
        ],
        floors: const [
          {
            'id': '22222222-2222-4222-8222-222222222222',
            'block_id': '11111111-1111-4111-8111-111111111111',
            'floor_name': '3rd Floor',
            'is_active': true,
          },
        ],
        locations: const [
          {
            'id': '33333333-3333-4333-8333-333333333333',
            'block_id': '11111111-1111-4111-8111-111111111111',
            'floor_id': '22222222-2222-4222-8222-222222222222',
            'location_name': 'Block A UAT Ward',
            'is_active': true,
          },
        ],
        categories: const [
          {
            'id': '44444444-4444-4444-8444-444444444444',
            'category_name': 'General Housekeeping',
            'is_active': true,
          },
        ],
      );

      final draft =
          ComplaintDraft(
              block: 'Block A',
              floor: '3rd Floor',
              location: 'Block A UAT Ward',
              category: 'General Housekeeping',
              priority: TicketPriority.high,
              description: 'Bed sheet change required.',
            )
            ..blockId = '11111111-1111-4111-8111-111111111111'
            ..floorId = '22222222-2222-4222-8222-222222222222'
            ..locationId = '33333333-3333-4333-8333-333333333333';

      final payload = controller.createPayloadForTesting(draft);

      expect(payload['block_id'], '11111111-1111-4111-8111-111111111111');
      expect(payload['floor_id'], '22222222-2222-4222-8222-222222222222');
      expect(payload['location_id'], '33333333-3333-4333-8333-333333333333');
      expect(payload['category_id'], '44444444-4444-4444-8444-444444444444');
      expect(payload['priority'], 'high');
    },
  );

  test('manual exact location cannot replace required floor and area ids', () {
    final controller = TicketController(demoMode: false);
    controller.replaceMastersForTesting(
      blocks: const [
        {
          'id': '11111111-1111-4111-8111-111111111111',
          'block_name': 'Block A',
          'is_active': true,
        },
      ],
      locations: const [],
      categories: const [
        {
          'id': '44444444-4444-4444-8444-444444444444',
          'category_name': 'General Housekeeping',
          'is_active': true,
        },
      ],
    );

    final draft =
        ComplaintDraft(
            block: 'Block A',
            category: 'General Housekeeping',
            priority: TicketPriority.high,
            description: 'Lift lobby requires cleaning.',
          )
          ..blockId = '11111111-1111-4111-8111-111111111111'
          ..exactLandmark = 'Near Lift No. 2, opposite Nursing Station';

    expect(controller.isDraftValid(draft), isFalse);
    expect(
      () => controller.createPayloadForTesting(draft),
      throwsA(isA<HospitalApiException>()),
    );
  });

  test('block and priority without location details remains invalid', () {
    final controller = TicketController(demoMode: false);
    final draft = ComplaintDraft(
      block: 'Block A',
      category: 'General Housekeeping',
      priority: TicketPriority.high,
      description: 'Lift lobby requires cleaning.',
    )..blockId = '11111111-1111-4111-8111-111111111111';

    expect(controller.isDraftValid(draft), isFalse);
  });

  test(
    'production controller clears stale hierarchy masters between users',
    () {
      final controller = TicketController(demoMode: false)
        ..replaceMastersForTesting(
          blocks: const [
            {'id': 'demo-block-a', 'block_name': 'Block A', 'is_active': true},
          ],
          floors: const [
            {
              'id': 'demo-floor-a',
              'block_id': 'demo-block-a',
              'floor_name': 'Ground Floor',
              'is_active': true,
            },
          ],
          locations: const [
            {
              'id': 'demo-location-a',
              'block_id': 'demo-block-a',
              'floor_id': 'demo-floor-a',
              'location_name': 'OPD Waiting Area',
              'is_active': true,
            },
          ],
        );

      expect(controller.hospitalBlocks.single.name, 'Block A');

      controller.clearSessionState();

      expect(controller.hospitalBlocks, isEmpty);
      expect(controller.hospitalFloors, isEmpty);
      expect(controller.hospitalLocations, isEmpty);
    },
  );

  test('ticket filters search by ticket id and location', () {
    final controller = TicketController(demoMode: true);
    final all = controller.filterTickets(TicketListFilter.all);
    expect(all, isNotEmpty);
    expect(
      all.every((ticket) => ticketMatchesFilter(ticket, TicketListFilter.all)),
      isTrue,
    );

    final locationMatches = controller.filterTickets(
      TicketListFilter.all,
      query: '3rd Floor',
    );
    expect(locationMatches, hasLength(1));
    expect(locationMatches.single.location, 'Staff Washroom');
  });

  test('ticket filters keep all loaded records visible under All', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus('ticket-1', 'QPMS-HK-2026-000001', 'open'),
        _ticketFromStatus('ticket-2', 'QPMS-HK-2026-000002', 'closed'),
        _ticketFromStatus(
          'ticket-3',
          'QPMS-HK-2026-000003',
          'escalated_project_head',
        ),
      ]);

    final all = controller.filterTickets(TicketListFilter.all);

    expect(all.map((ticket) => ticket.number), [
      'QPMS-HK-2026-000001',
      'QPMS-HK-2026-000002',
      'QPMS-HK-2026-000003',
    ]);
  });

  test('closed filter returns closed ticket cards source records', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus('ticket-open', 'QPMS-HK-2026-000010', 'open'),
        _ticketFromStatus('ticket-closed-a', 'QPMS-HK-2026-000011', 'closed'),
        _ticketFromStatus('ticket-closed-b', 'QPMS-HK-2026-000012', 'closed'),
      ]);

    final closed = controller.filterTickets(TicketListFilter.closed);

    expect(closed, hasLength(2));
    expect(
      closed.every((ticket) => ticket.status == TicketStatus.closed),
      true,
    );
  });

  test('open filter matches received and assigned backend statuses', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus('ticket-open', 'QPMS-HK-2026-000020', 'open'),
        _ticketFromStatus('ticket-assigned', 'QPMS-HK-2026-000021', 'assigned'),
        _ticketFromStatus('ticket-closed', 'QPMS-HK-2026-000022', 'closed'),
      ]);

    final open = controller.filterTickets(TicketListFilter.open);

    expect(open.map((ticket) => ticket.number), [
      'QPMS-HK-2026-000020',
      'QPMS-HK-2026-000021',
    ]);
  });

  test('in progress filter includes active and escalated backend statuses', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus('ticket-accepted', 'QPMS-HK-2026-000030', 'accepted'),
        _ticketFromStatus(
          'ticket-progress',
          'QPMS-HK-2026-000031',
          'in_progress',
        ),
        _ticketFromStatus(
          'ticket-ops',
          'QPMS-HK-2026-000032',
          'escalated_operations_executive',
        ),
        _ticketFromStatus(
          'ticket-fm',
          'QPMS-HK-2026-000033',
          'escalated_facility_manager',
        ),
        _ticketFromStatus(
          'ticket-ph',
          'QPMS-HK-2026-000034',
          'escalated_project_head',
        ),
        _ticketFromStatus('ticket-reopened', 'QPMS-HK-2026-000035', 'reopened'),
      ]);

    final inProgress = controller.filterTickets(TicketListFilter.inProgress);

    expect(inProgress, hasLength(6));
    expect(
      inProgress.map((ticket) => ticket.status),
      contains(TicketStatus.escalatedProjectHead),
    );
  });

  test('work completed filter accepts resolved and awaiting aliases', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus(
          'ticket-resolved',
          'QPMS-HK-2026-000040',
          'resolved_awaiting_confirmation',
        ),
        _ticketFromStatus(
          'ticket-work-completed',
          'QPMS-HK-2026-000041',
          'work_completed',
        ),
        _ticketFromStatus(
          'ticket-awaiting',
          'QPMS-HK-2026-000042',
          'awaiting_confirmation',
        ),
        _ticketFromStatus('ticket-open', 'QPMS-HK-2026-000043', 'open'),
      ]);

    final completed = controller.filterTickets(
      TicketListFilter.awaitingConfirmation,
    );

    expect(completed.map((ticket) => ticket.number), [
      'QPMS-HK-2026-000040',
      'QPMS-HK-2026-000041',
      'QPMS-HK-2026-000042',
    ]);
  });

  test('empty search text does not remove visible tickets', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus('ticket-a', 'QPMS-HK-2026-000050', 'open'),
        _ticketFromStatus('ticket-b', 'QPMS-HK-2026-000051', 'closed'),
      ]);

    expect(
      controller.filterTickets(TicketListFilter.all, query: '   '),
      hasLength(2),
    );
  });

  test(
    'search filters by ticket number, location, category, and description',
    () {
      final controller = TicketController(demoMode: false)
        ..replaceTicketsForTesting([
          _ticketFromStatus(
            'ticket-match',
            'QPMS-HK-2026-000060',
            'open',
            location: 'NIMS OPD',
            description: 'Wet floor near reception.',
          ),
          _ticketFromStatus(
            'ticket-other',
            'QPMS-HK-2026-000061',
            'open',
            location: 'ICU',
            description: 'Consumables required.',
          ),
        ]);

      final matches = controller.filterTickets(
        TicketListFilter.all,
        query: 'opd',
      );

      expect(matches, hasLength(1));
      expect(matches.single.number, 'QPMS-HK-2026-000060');
    },
  );

  test('unknown backend status still appears in All', () {
    final controller = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticketFromStatus(
          'ticket-unknown',
          'QPMS-HK-2026-000070',
          'new_backend_status',
        ),
      ]);

    final all = controller.filterTickets(TicketListFilter.all);

    expect(all, hasLength(1));
    expect(all.single.number, 'QPMS-HK-2026-000070');
  });

  test(
    'ticket collection dedupes by stable id without merging distinct tickets',
    () {
      final controller = TicketController(demoMode: false)
        ..replaceTicketsForTesting([
          _ticketFromStatus('same-id', 'QPMS-HK-2026-000080', 'open'),
          _ticketFromStatus('same-id', 'QPMS-HK-2026-000080', 'open'),
          _ticketFromStatus('ticket-next', 'QPMS-HK-2026-000081', 'open'),
        ]);

      final all = controller.filterTickets(TicketListFilter.all);

      expect(all.map((ticket) => ticket.number), [
        'QPMS-HK-2026-000080',
        'QPMS-HK-2026-000081',
      ]);
    },
  );

  test(
    'safe ticket lookup supports ticket number and uuid without throwing',
    () {
      final controller = TicketController(demoMode: true);
      final ticket = controller.tickets.first;
      expect(controller.findTicket(ticket.number), ticket);
      expect(controller.findTicket(ticket.id), ticket);
      expect(controller.findTicket('not-a-ticket'), isNull);
    },
  );

  test(
    'photo partial failure exception preserves created ticket reference',
    () {
      final ticket = Ticket(
        id: 'ticket-uuid',
        number: 'QPMS-HK-2026-0099',
        block: 'Block A',
        floor: '',
        location: '',
        exactLandmark: 'Near Lift No. 2',
        category: 'General Housekeeping',
        description: 'Floor cleaning required.',
        priority: TicketPriority.high,
        raisedBy: 'Doctor',
        raisedAt: DateTime(2026, 8, 12, 11, 30),
        status: TicketStatus.open,
        assignedPerson: 'Assignment pending',
        assignedRole: 'Housekeeping Supervisor',
        slaLabel: 'Supervisor SLA • 20 minutes',
      );

      final error = TicketPhotoUploadPartialException(ticket, 2);

      expect(error.ticket.number, 'QPMS-HK-2026-0099');
      expect(error.failedCount, 2);
    },
  );

  test('satisfied feedback closes the same resolved ticket', () async {
    final controller = TicketController(demoMode: true);
    const number = 'QPMS-HK-2026-0003';
    final countBefore = controller.tickets.length;

    await controller.submitFeedback(
      ticketNumber: number,
      rating: 5,
      comment: 'Clean and ready for use.',
      satisfied: true,
      now: DateTime(2026, 7, 16, 11),
    );

    final ticket = controller.ticketByNumber(number);
    expect(controller.tickets.length, countBefore);
    expect(ticket.status, TicketStatus.closed);
    expect(ticket.isSatisfied, isTrue);
    expect(ticket.updates.last.title, 'Closed');
  });

  test('not satisfied reopens the same ticket without duplication', () async {
    final controller = TicketController(demoMode: true);
    const number = 'QPMS-HK-2026-0003';
    final countBefore = controller.tickets.length;

    await controller.submitFeedback(
      ticketNumber: number,
      rating: 2,
      comment: 'Floor is still wet near the entrance.',
      satisfied: false,
      now: DateTime(2026, 7, 16, 11),
    );

    final ticket = controller.ticketByNumber(number);
    expect(controller.tickets.length, countBefore);
    expect(ticket.status, TicketStatus.open);
    expect(ticket.assignedRole, 'Housekeeping Supervisor');
    expect(ticket.slaLabel, contains('restarted'));
    expect(ticket.updates.last.title, 'Reopened');
  });

  test(
    'client can soft-cancel an active ticket with an audit reason',
    () async {
      final controller = TicketController(demoMode: true);
      const number = 'QPMS-HK-2026-0005';

      await controller.cancelTicket(
        ticketNumber: number,
        reasonCode: 'duplicate_complaint',
        reasonText: 'Duplicate complaint',
        now: DateTime(2026, 7, 16, 11),
      );

      final ticket = controller.ticketByNumber(number);
      expect(ticket.status, TicketStatus.cancelled);
      expect(ticket.cancellationReasonCode, 'duplicate_complaint');
      expect(ticket.cancellationReasonText, 'Duplicate complaint');
      expect(ticket.updates.last.title, 'Cancelled');
    },
  );

  test(
    'client cannot cancel a ticket awaiting completion confirmation',
    () async {
      final controller = TicketController(demoMode: true);
      expect(
        () => controller.cancelTicket(
          ticketNumber: 'QPMS-HK-2026-0003',
          reasonCode: 'raised_by_mistake',
          reasonText: 'Raised by mistake',
        ),
        throwsStateError,
      );
    },
  );

  test('mark all notifications as read works', () async {
    final notifications = NotificationController(demoMode: true);
    expect(notifications.unreadCount, greaterThan(0));
    await notifications.markAllRead();
    expect(notifications.unreadCount, 0);
  });
}

Ticket _ticketFromStatus(
  String id,
  String number,
  String statusCode, {
  String location = 'NIMS Ward',
  String description = 'Housekeeping support required.',
}) => Ticket.fromApi({
  'id': id,
  'version': 1,
  'ticket_no': number,
  'block_name_snapshot': 'NIMS Block',
  'floor_name': 'Ground Floor',
  'location_text': location,
  'category': {'category_name': 'Housekeeping'},
  'description': description,
  'priority': 'medium',
  'raised_by_name': 'NIMS Contact',
  'raised_at': '2026-08-25T10:00:00.000Z',
  'status_code': statusCode,
  'current_assignee_role': 'housekeeping_supervisor',
  'sla_label': 'Supervisor SLA - 20 minutes',
});
