import 'package:client_ticketing_app/data/mock_data.dart';
import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/state/auth_controller.dart';
import 'package:client_ticketing_app/state/notification_controller.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('Login succeeds for admin/admin', () async {
    final auth = AuthController();
    final ok = await auth.login('admin', 'admin');
    expect(ok, isTrue);
    expect(auth.isAuthenticated, isTrue);
  });

  test('Login fails for incorrect credentials', () async {
    final auth = AuthController();
    final ok = await auth.login('admin', 'wrong');
    expect(ok, isFalse);
    expect(auth.isAuthenticated, isFalse);
  });

  test('Ticket validation blocks incomplete submission', () {
    final tickets = TicketController();
    final draft = DraftTicket(title: '', description: 'Need help');
    expect(tickets.isDraftValid(draft), isFalse);
  });

  test('Ticket submission adds the ticket locally', () {
    final tickets = TicketController();
    final draft = DraftTicket();
    final submitted = tickets.submitDraft(draft);
    expect(submitted.number, featuredTicketNumber);
    expect(tickets.tickets.first.number, featuredTicketNumber);
    expect(tickets.tickets.first.title, 'Lights Flickering in Main Corridor');
  });

  test('Status filters return the correct tickets', () {
    final tickets = TicketController();
    final closed = tickets.filterByStatus(TicketStatus.closed);
    expect(closed, isNotEmpty);
    expect(
      closed.every((ticket) => ticket.status == TicketStatus.closed),
      isTrue,
    );
  });

  test('Mark all notifications as read works', () async {
    final notifications = NotificationController();
    expect(notifications.unreadCount, greaterThan(0));
    await notifications.markAllRead();
    expect(notifications.unreadCount, 0);
    expect(notifications.items.every((item) => item.isRead), isTrue);
  });
}
