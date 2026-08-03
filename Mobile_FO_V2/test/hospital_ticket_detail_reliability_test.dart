import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_controller.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_models.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_ticket_api.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_ticket_detail_screen.dart';

const ticketId = '550e8400-e29b-41d4-a716-446655440000';
const ticketNumber = 'QPMS-HK-2026-000001';

void main() {
  HospitalDemoSession session({
    HospitalDemoRole role = HospitalDemoRole.supervisor,
  }) {
    return HospitalDemoSession(
      loginId: 'sup.blocka@qpmsdemo.com',
      displayName: 'Supervisor Block A',
      role: role,
      assignedBlock: role == HospitalDemoRole.supervisor ? 'Block A' : null,
      isDemo: false,
    );
  }

  HospitalController controller(_FakeHospitalTicketGateway api) {
    return HospitalController(
      session: session(),
      api: api,
      productionMode: true,
    );
  }

  group('hospital detail reliability', () {
    test(
      'list polling preserves detail timeline, attachments, and actions',
      () async {
        final api = _FakeHospitalTicketGateway()
          ..ticketRows = [_ticketRow()]
          ..detailResponses.add(_detailResponse());
        final value = controller(api);

        await value.load();
        await value.loadDetail(ticketId);
        expect(value.ticketById(ticketId).events, hasLength(1));
        expect(
          value.ticketById(ticketId).allowedActions,
          contains(HospitalTicketAction.accept),
        );

        api.ticketRows = [_ticketRow(status: 'in_progress')];
        await value.load();

        final ticket = value.ticketById(ticketId);
        expect(ticket.status, HospitalTicketStatus.inProgress);
        expect(ticket.events, hasLength(1));
        expect(ticket.allowedActions, contains(HospitalTicketAction.accept));
      },
    );

    test('attachment signing failure does not block timeline data', () async {
      final api = _FakeHospitalTicketGateway()
        ..ticketRows = [_ticketRow()]
        ..detailResponses.add(
          _detailResponse(
            attachments: [
              {'id': 'photo-1', 'attachment_type': 'complaint_photo'},
            ],
          ),
        )
        ..failSignedDownload = true;
      final value = controller(api);

      await value.load();
      await value.loadDetail(ticketId);
      await Future<void>.delayed(Duration.zero);

      expect(value.ticketById(ticketId).events, hasLength(1));
      expect(value.ticketById(ticketId).complaintPhotoPaths, isEmpty);
      expect(value.detailError(ticketId), isNull);
    });

    test(
      'duplicate detail request is prevented while one is already in progress',
      () async {
        final api = _FakeHospitalTicketGateway()..ticketRows = [_ticketRow()];
        final pending = Completer<Map<String, dynamic>>();
        api.detailCompleters.add(pending);
        final value = controller(api);

        await value.load();
        final first = value.loadDetail(ticketId);
        await value.loadDetail(ticketId);

        expect(api.fetchDetailCount, 1);
        pending.complete(_detailResponse());
        await first;
      },
    );

    test(
      'stale forced detail response is ignored for the same ticket',
      () async {
        final api = _FakeHospitalTicketGateway()..ticketRows = [_ticketRow()];
        final first = Completer<Map<String, dynamic>>();
        final second = Completer<Map<String, dynamic>>();
        api.detailCompleters.addAll([first, second]);
        final value = controller(api);

        await value.load();
        final firstLoad = value.loadDetail(ticketId);
        final secondLoad = value.loadDetail(ticketId, force: true);
        second.complete(_detailResponse(eventType: 'work_started'));
        await secondLoad;
        first.complete(_detailResponse(eventType: 'assigned'));
        await firstLoad;

        expect(value.ticketById(ticketId).events.single.action, 'work started');
      },
    );

    test(
      'remote action failure keeps existing detail and reports failure',
      () async {
        final api = _FakeHospitalTicketGateway()
          ..ticketRows = [_ticketRow()]
          ..detailResponses.add(_detailResponse())
          ..actionError = const HospitalTicketApiException('Action failed.');
        final value = controller(api);

        await value.load();
        await value.loadDetail(ticketId);

        await expectLater(
          value.accept(ticketId),
          throwsA(isA<HospitalTicketApiException>()),
        );
        expect(
          value.ticketById(ticketId).status,
          HospitalTicketStatus.assigned,
        );
        expect(value.ticketById(ticketId).events, hasLength(1));
      },
    );
  });

  group('hospital detail UI', () {
    testWidgets('renders compact tabs and sticky primary action', (
      tester,
    ) async {
      final api = _FakeHospitalTicketGateway()
        ..ticketRows = [_ticketRow()]
        ..detailResponses.add(_detailResponse())
        ..detailResponses.add(_detailResponse());
      final value = controller(api);
      await value.load();
      await value.loadDetail(ticketId);

      await tester.pumpWidget(
        MaterialApp(
          home: HospitalTicketDetailScreen(
            controller: value,
            ticketId: ticketId,
          ),
        ),
      );
      await tester.pump();

      expect(find.text(ticketNumber), findsWidgets);
      expect(find.text('Overview'), findsOneWidget);
      expect(find.text('Timeline'), findsOneWidget);
      expect(find.text('Actions'), findsOneWidget);
      expect(find.text('Accept Ticket'), findsOneWidget);
      expect(find.text(ticketId), findsNothing);

      await tester.tap(find.widgetWithText(Tab, 'Timeline'));
      await tester.pumpAndSettle();
      expect(find.text('Assigned'), findsWidgets);

      await tester.tap(find.text('Actions'));
      await tester.pumpAndSettle();
      expect(find.text('No other actions available'), findsOneWidget);
    });

    testWidgets('selected tab remains after controller refresh', (
      tester,
    ) async {
      final api = _FakeHospitalTicketGateway()
        ..ticketRows = [_ticketRow()]
        ..detailResponses.add(_detailResponse())
        ..detailResponses.add(_detailResponse());
      final value = controller(api);
      await value.load();
      await value.loadDetail(ticketId);

      await tester.pumpWidget(
        MaterialApp(
          home: HospitalTicketDetailScreen(
            controller: value,
            ticketId: ticketId,
          ),
        ),
      );
      await tester.tap(find.widgetWithText(Tab, 'Timeline'));
      await tester.pumpAndSettle();

      api.ticketRows = [_ticketRow(status: 'in_progress')];
      await value.load();
      await tester.pump();

      expect(find.textContaining('Last updated'), findsOneWidget);
      expect(find.text('work started'), findsNothing);
    });
  });
}

class _FakeHospitalTicketGateway implements HospitalTicketGateway {
  List<Map<String, dynamic>> ticketRows = const [];
  final List<Map<String, dynamic>> detailResponses = [];
  final List<Completer<Map<String, dynamic>>> detailCompleters = [];
  HospitalTicketApiException? actionError;
  bool failSignedDownload = false;
  int fetchDetailCount = 0;

  @override
  Future<List<HospitalTicket>> fetchTickets() async {
    return ticketRows.map(HospitalTicket.fromApi).toList();
  }

  @override
  Future<List<Map<String, dynamic>>> fetchNotifications() async => const [];

  @override
  Future<Map<String, dynamic>> fetchDutyStatus() async => const {
    'duty': {'duty_status': 'off_duty'},
  };

  @override
  Future<Map<String, dynamic>> startDuty({String? cugNumber}) async => const {
    'duty': {'duty_status': 'on_duty'},
  };

  @override
  Future<Map<String, dynamic>> endDuty() async => const {
    'duty': {'duty_status': 'off_duty'},
  };

  @override
  Future<void> markNotificationRead(String id) async {}

  @override
  Future<Map<String, dynamic>> fetchDetail(String ticketId) {
    fetchDetailCount += 1;
    if (detailCompleters.isNotEmpty) {
      return detailCompleters.removeAt(0).future;
    }
    return Future.value(detailResponses.removeAt(0));
  }

  @override
  Future<String> signedDownload(String ticketId, String attachmentId) async {
    if (failSignedDownload) {
      throw const HospitalTicketApiException('Photo failed.');
    }
    return 'https://signed.example/$attachmentId';
  }

  @override
  Future<Map<String, dynamic>> action(
    String ticketId,
    String path,
    int version, [
    Map<String, dynamic> payload = const {},
  ]) async {
    if (actionError != null) throw actionError!;
    return _detailResponse(status: path == 'accept' ? 'accepted' : 'assigned');
  }

  @override
  Future<void> uploadPhoto(
    String ticketId,
    String filePath,
    String type,
  ) async {}
}

Map<String, dynamic> _detailResponse({
  String status = 'assigned',
  String eventType = 'assigned',
  List<Map<String, dynamic>> attachments = const [],
}) {
  return {
    'ticket': _ticketRow(status: status),
    'timeline': [
      {
        'event_type': eventType,
        'actor_name': 'Supervisor Block A',
        'actor_role': 'housekeeping_supervisor',
        'created_at': '2026-07-16T10:05:00Z',
        'remarks': 'Assigned for action.',
      },
    ],
    'attachments': attachments,
    'allowed_actions': ['accept'],
  };
}

Map<String, dynamic> _ticketRow({String status = 'assigned'}) {
  return {
    'id': ticketId,
    'ticket_no': ticketNumber,
    'site_name_snapshot': 'NIMS Demo Hospital',
    'block_name_snapshot': 'Block A',
    'floor_name_snapshot': 'Second Floor',
    'department_name_snapshot': 'Housekeeping',
    'room_area_snapshot': 'Ward 201',
    'location_text': 'Ward corridor',
    'exact_landmark_snapshot': 'Near nursing station',
    'location_path_snapshot':
        'NIMS Demo Hospital > Block A > Second Floor > Housekeeping > Ward 201',
    'category': {'category_name': 'General Housekeeping'},
    'priority': 'medium',
    'description':
        'Housekeeping complaint requiring a compact operational view and a reliable activity timeline.',
    'raised_by_name': 'Hospital Management',
    'raised_at': '2026-07-16T10:00:00Z',
    'assigned_at': '2026-07-16T10:02:00Z',
    'status_code': status,
    'current_assignee_role': 'housekeeping_supervisor',
    'assignee': {
      'display_name': 'Supervisor Block A',
      'role_code': 'housekeeping_supervisor',
    },
    'supervisor_sla_due_at': '2026-07-16T10:20:00Z',
    'version': 1,
  };
}
