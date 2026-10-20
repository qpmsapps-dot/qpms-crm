import 'package:client_ticketing_app/app/routes.dart';
import 'package:client_ticketing_app/features/tickets/my_tickets_screen.dart';
import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/state/notification_controller.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('My Tickets renders non-empty All and Closed card lists', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final tickets = TicketController(demoMode: false)
      ..replaceTicketsForTesting([
        _ticket('ticket-1', 'QPMS-HK-2026-000090', 'open'),
        _ticket('ticket-2', 'QPMS-HK-2026-000091', 'closed'),
        _ticket('ticket-3', 'QPMS-HK-2026-000092', 'closed'),
      ]);
    final notifications = NotificationController(demoMode: false);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<TicketController>.value(value: tickets),
          ChangeNotifierProvider<NotificationController>.value(
            value: notifications,
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(0.85)),
            child: child ?? const SizedBox.shrink(),
          ),
          routes: {AppRoutes.ticketDetails: (_) => const SizedBox.shrink()},
          home: const MyTicketsScreen(),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.text('3 Tickets'), findsOneWidget);
    expect(find.text('QPMS-HK-2026-000090'), findsOneWidget);

    await tester.ensureVisible(find.text('Closed').first);
    await tester.tap(find.text('Closed').first);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('2 Tickets'), findsOneWidget);
    expect(find.text('QPMS-HK-2026-000091'), findsOneWidget);
    expect(find.text('QPMS-HK-2026-000092'), findsOneWidget);
  });
}

Ticket _ticket(String id, String number, String statusCode) => Ticket.fromApi({
  'id': id,
  'version': 1,
  'ticket_no': number,
  'block_name_snapshot': 'NIMS Block',
  'floor_name': 'Ground Floor',
  'location_text': 'NIMS Ward',
  'category': {'category_name': 'Housekeeping'},
  'description': 'Housekeeping support required.',
  'priority': 'medium',
  'raised_by_name': 'NIMS Contact',
  'raised_at': '2026-08-25T10:00:00.000Z',
  'status_code': statusCode,
  'current_assignee_role': 'housekeeping_supervisor',
  'sla_label': 'Supervisor SLA - 20 minutes',
});
