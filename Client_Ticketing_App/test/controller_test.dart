import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/state/auth_controller.dart';
import 'package:client_ticketing_app/state/notification_controller.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
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
        ),
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

  test('mark all notifications as read works', () async {
    final notifications = NotificationController(demoMode: true);
    expect(notifications.unreadCount, greaterThan(0));
    await notifications.markAllRead();
    expect(notifications.unreadCount, 0);
  });
}
