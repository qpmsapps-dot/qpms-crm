import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_controller.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_models.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_sla_policy.dart';

void main() {
  final seed = DateTime(2026, 7, 16, 10);

  test('duty API methods use the Day 3 backend routes', () {
    final api = File(
      'lib/hospital_housekeeping/hospital_ticket_api.dart',
    ).readAsStringSync();

    expect(api, contains("request('GET', '/api/hospital-tickets/me/duty')"));
    expect(
      api,
      contains("request('POST', '/api/hospital-tickets/me/duty/start'"),
    );
    expect(
      api,
      contains("request('POST', '/api/hospital-tickets/me/duty/end')"),
    );
    expect(api, contains("body['cug_number'] = cugNumber"));
  });

  test('real supervisor session can display multiple assigned blocks', () {
    const session = HospitalDemoSession(
      loginId: '9948310098',
      displayName: 'L. V. Sai',
      role: HospitalDemoRole.supervisor,
      assignedBlock: 'OPD Block',
      assignedBlocks: ['OPD Block', 'Admin Block', 'Oncology Block'],
      shiftLabel: '8 AM - 4 PM',
      isDemo: false,
    );

    expect(session.scopeLabel, 'OPD Block, Admin Block, Oncology Block');
    expect(session.shiftLabel, '8 AM - 4 PM');
  });

  test(
    'controller parses backend duty status response during refresh',
    () async {
      final gateway = _DutyGateway(
        dutyResponse: {
          'ok': true,
          'duty': {
            'duty_status': 'on_duty',
            'duty_started_at': seed.toIso8601String(),
            'duty_ended_at': null,
            'last_seen_at': seed.toIso8601String(),
            'cug_number': '9999999999',
          },
        },
      );
      final controller = _controller(gateway);

      await controller.load();

      expect(gateway.fetchDutyStatusCount, 1);
      expect(controller.dutyStatus, 'on_duty');
      expect(controller.isOnDuty, isTrue);
    },
  );

  test('supervisor dashboard merges incoming unassigned broadcast tickets', () async {
    final acceptanceDue = DateTime.now().add(const Duration(minutes: 2));
    final gateway = _DutyGateway(
      dutyResponse: {
        'duty': {'duty_status': 'on_duty'},
      },
      incomingTickets: [
        HospitalTicket.fromApi({
          'id': 'b61f2940-506f-4009-8986-06d7583c682c',
          'ticket_no': 'QPMS-HK-2026-000048',
          'block_name_snapshot': 'MILLENNIUM BLOCK',
          'floor_name': 'Third Floor',
          'location_text': 'Nephrology Unit I (MB Block 3rd Floor)',
          'category': {'category_name': 'Housekeeping'},
          'priority': 'high',
          'description': 'Incoming broadcast ticket',
          'raised_by_name': 'NIMS contact',
          'raised_at': seed.toIso8601String(),
          'status_code': 'awaiting_supervisor_acceptance',
          'acceptance_status': 'awaiting',
          'acceptance_due_at': acceptanceDue.toIso8601String(),
          'current_assignee_user_id': null,
          'supervisor_user_id': null,
          'assigned_at': null,
          'allowed_actions': ['accept'],
        }),
      ],
    );
    final controller = _controller(gateway);

    await controller.load();

    expect(gateway.fetchIncomingTicketsCount, 1);
    expect(controller.incomingTickets, hasLength(1));
    expect(controller.summary.awaitingAcceptance, 1);
    expect(controller.summary.newComplaints, 1);
    expect(controller.incomingTickets.single.block, 'MILLENNIUM BLOCK');
    expect(
      controller.actionsFor(controller.incomingTickets.single),
      contains(HospitalTicketAction.accept),
    );
  });

  test('incoming queue endpoint is called through the mobile API', () {
    final api = File(
      'lib/hospital_housekeeping/hospital_ticket_api.dart',
    ).readAsStringSync();

    expect(
      api,
      contains("'/api/hospital-tickets/supervisor/incoming'"),
    );
  });

  test('start duty calls backend gateway and refreshes server state', () async {
    final gateway = _DutyGateway(
      dutyResponse: {
        'duty': {'duty_status': 'on_duty'},
      },
      startResponse: {
        'ok': true,
        'duty': {'duty_status': 'on_duty'},
      },
    );
    final controller = _controller(gateway);

    await controller.startDuty(cugNumber: ' 9999999999 ');

    expect(gateway.startDutyCount, 1);
    expect(gateway.lastCugNumber, ' 9999999999 ');
    expect(gateway.fetchDutyStatusCount, 1);
    expect(controller.isOnDuty, isTrue);
  });

  test(
    'end duty calls backend gateway and preserves server authority',
    () async {
      final gateway = _DutyGateway(
        dutyResponse: {
          'duty': {'duty_status': 'off_duty'},
        },
        endResponse: {
          'ok': true,
          'duty': {'duty_status': 'off_duty'},
        },
      );
      final controller = _controller(gateway);

      await controller.endDuty();

      expect(gateway.endDutyCount, 1);
      expect(gateway.fetchDutyStatusCount, 1);
      expect(controller.isOnDuty, isFalse);
    },
  );

  test('critical supervisor SLA falls back to ten minutes', () {
    final ticket = _ticket(priority: HospitalPriority.high);

    final due = const HospitalSlaPolicy().dueAt(ticket);

    expect(due, seed.add(const Duration(minutes: 10)));
  });

  test('medium supervisor SLA falls back to fifteen minutes', () {
    final ticket = _ticket(priority: HospitalPriority.medium);

    final due = const HospitalSlaPolicy().dueAt(ticket);

    expect(due, seed.add(const Duration(minutes: 15)));
  });

  test('low supervisor SLA falls back to twenty minutes', () {
    final ticket = _ticket(priority: HospitalPriority.low);

    final due = const HospitalSlaPolicy().dueAt(ticket);

    expect(due, seed.add(const Duration(minutes: 20)));
  });

  test('legacy high priority API value is treated as critical', () {
    final ticket = HospitalTicket.fromApi({
      'id': 'ticket-high',
      'block_name_snapshot': 'Block A',
      'location_text': 'Ward',
      'category': {'category_name': 'Housekeeping'},
      'priority': 'high',
      'description': 'Test',
      'raised_by_name': 'Doctor',
      'raised_at': seed.toIso8601String(),
      'status_code': 'assigned',
      'current_assignee_role': 'housekeeping_supervisor',
      'assignee': {'display_name': 'Supervisor A'},
    });

    final due = const HospitalSlaPolicy().dueAt(ticket);

    expect(ticket.priority, HospitalPriority.high);
    expect(due, seed.add(const Duration(minutes: 10)));
  });

  test(
    'server supervisor deadline is preferred over local priority fallback',
    () {
      final serverDue = seed.add(const Duration(minutes: 7));
      final ticket = _ticket(
        priority: HospitalPriority.low,
        supervisorDueAt: serverDue,
      );

      final due = const HospitalSlaPolicy().dueAt(ticket);

      expect(due, serverDue);
    },
  );

  test(
    'Firebase notification routing contract opens exact hospital ticket',
    () {
      final push = File(
        'lib/hospital_housekeeping/hospital_push_service.dart',
      ).readAsStringSync();
      final shell = File(
        'lib/hospital_housekeeping/hospital_shell.dart',
      ).readAsStringSync();

      expect(push, contains('onMessageOpenedApp.listen'));
      expect(push, contains('getInitialMessage'));
      expect(push, contains('openImmediately: true'));
      expect(push, contains('usesChronometer: incoming'));
      expect(push, contains('chronometerCountDown: incoming'));
      expect(push, contains('timeoutAfter: incoming ? _remainingMs(push) : null'));
      expect(push, contains("acceptActionId = 'hospital_accept_ticket'"));
      expect(push, contains("viewActionId = 'hospital_view_ticket'"));
      expect(push, contains("HospitalTicketApi.action(ticketId, 'accept'"));
      expect(shell, contains('HospitalTicketDetailScreen'));
      expect(shell, contains('ticketId: ticketId'));
      expect(shell, contains('message.ticketId'));
    },
  );
}

HospitalController _controller(_DutyGateway gateway) => HospitalController(
  session: const HospitalDemoSession(
    loginId: 'supervisor@example.com',
    displayName: 'Supervisor A',
    role: HospitalDemoRole.supervisor,
    assignedBlock: 'Block A',
    isDemo: false,
  ),
  api: gateway,
);

HospitalTicket _ticket({
  required HospitalPriority priority,
  DateTime? supervisorDueAt,
}) => HospitalTicket(
  id: 'ticket-${priority.name}',
  block: 'Block A',
  floor: 'Second Floor',
  location: 'Ward',
  category: 'Housekeeping',
  priority: priority,
  description: 'Test',
  reportedBy: 'Doctor',
  raisedAt: DateTime(2026, 7, 16, 10),
  status: HospitalTicketStatus.assigned,
  responsiblePerson: 'Supervisor A',
  responsibleRole: HospitalDemoRole.supervisor.label,
  supervisorName: 'Supervisor A',
  supervisorDueAt: supervisorDueAt,
  events: const [],
);

class _DutyGateway implements HospitalTicketGateway {
  _DutyGateway({
    required this.dutyResponse,
    Map<String, dynamic>? startResponse,
    Map<String, dynamic>? endResponse,
    this.incomingTickets = const [],
  }) : startResponse = startResponse ?? dutyResponse,
       endResponse = endResponse ?? dutyResponse;

  Map<String, dynamic> dutyResponse;
  final Map<String, dynamic> startResponse;
  final Map<String, dynamic> endResponse;
  final List<HospitalTicket> incomingTickets;
  int fetchDutyStatusCount = 0;
  int fetchIncomingTicketsCount = 0;
  int startDutyCount = 0;
  int endDutyCount = 0;
  String? lastCugNumber;

  @override
  Future<List<HospitalTicket>> fetchTickets() async => const [];

  @override
  Future<List<HospitalTicket>> fetchIncomingTickets() async {
    fetchIncomingTicketsCount += 1;
    return incomingTickets;
  }

  @override
  Future<List<Map<String, dynamic>>> fetchNotifications() async => const [];

  @override
  Future<Map<String, dynamic>> fetchDutyStatus() async {
    fetchDutyStatusCount += 1;
    return dutyResponse;
  }

  @override
  Future<Map<String, dynamic>> startDuty({String? cugNumber}) async {
    startDutyCount += 1;
    lastCugNumber = cugNumber;
    return startResponse;
  }

  @override
  Future<Map<String, dynamic>> endDuty() async {
    endDutyCount += 1;
    return endResponse;
  }

  @override
  Future<void> markNotificationRead(String id) async {}

  @override
  Future<Map<String, dynamic>> fetchDetail(String ticketId) async => const {};

  @override
  Future<String> signedDownload(String ticketId, String attachmentId) async =>
      '';

  @override
  Future<Map<String, dynamic>> action(
    String ticketId,
    String path,
    int version, [
    Map<String, dynamic> payload = const {},
  ]) async => const {};

  @override
  Future<void> uploadPhoto(
    String ticketId,
    String filePath,
    String type,
  ) async {}
}
