import 'package:client_ticketing_app/app/client_ticket_deep_link.dart';
import 'package:client_ticketing_app/app/routes.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('QPMS client app accepts the hospital tickets deep link', () {
    final destination = ClientTicketDeepLink.parse('qpms://hospital-tickets');

    expect(destination, isNotNull);
    expect(destination!.hasTicket, isFalse);
    expect(destination.targetRoute, AppRoutes.tickets);
  });

  test('ticket ID deep link opens the ticket detail destination', () {
    final destination = ClientTicketDeepLink.parse(
      'qpms://hospital-tickets/QPMS-HK-2026-0001',
    );

    expect(destination, isNotNull);
    expect(destination!.ticketNumber, 'QPMS-HK-2026-0001');
    expect(destination.targetRoute, AppRoutes.ticketDetails);
  });

  test(
    'path-style hospital ticket route is supported by Flutter navigation',
    () {
      final destination = ClientTicketDeepLink.parse(
        '/hospital-tickets/QPMS-HK-2026-0002',
      );

      expect(destination, isNotNull);
      expect(destination!.ticketNumber, 'QPMS-HK-2026-0002');
    },
  );

  test(
    'unauthenticated deep link destination can be preserved through login',
    () {
      const destination = ClientTicketDeepLinkDestination(
        ticketNumber: 'QPMS-HK-2026-0003',
      );

      PendingClientTicketDeepLink.set(destination);

      final restored = PendingClientTicketDeepLink.take();
      expect(restored, same(destination));
      expect(restored!.targetRoute, AppRoutes.ticketDetails);
      expect(PendingClientTicketDeepLink.take(), isNull);
    },
  );

  test(
    'unrelated notification routes remain outside the hospital link parser',
    () {
      expect(ClientTicketDeepLink.parse(AppRoutes.notifications), isNull);
      expect(ClientTicketDeepLink.parse(AppRoutes.feedback), isNull);
    },
  );
}
