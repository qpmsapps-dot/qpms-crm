import 'routes.dart';

class ClientTicketDeepLinkDestination {
  const ClientTicketDeepLinkDestination({this.ticketNumber});

  final String? ticketNumber;

  bool get hasTicket => ticketNumber?.trim().isNotEmpty == true;

  String get targetRoute =>
      hasTicket ? AppRoutes.ticketDetails : AppRoutes.tickets;
}

class PendingClientTicketDeepLink {
  static ClientTicketDeepLinkDestination? _destination;

  static ClientTicketDeepLinkDestination? get destination => _destination;

  static void set(ClientTicketDeepLinkDestination destination) {
    _destination = destination;
  }

  static ClientTicketDeepLinkDestination? take() {
    final value = _destination;
    _destination = null;
    return value;
  }
}

class ClientTicketDeepLink {
  static const scheme = 'qpms';
  static const host = 'hospital-tickets';

  static ClientTicketDeepLinkDestination? parse(String? routeName) {
    final raw = (routeName ?? '').trim();
    if (raw.isEmpty || raw == AppRoutes.splash) return null;

    final uri = Uri.tryParse(raw);
    if (uri != null && uri.scheme == scheme && uri.host == host) {
      return ClientTicketDeepLinkDestination(
        ticketNumber: _cleanTicket(
          uri.pathSegments.isEmpty ? null : uri.pathSegments.first,
        ),
      );
    }

    if (raw == AppRoutes.deepLinkTickets) {
      return const ClientTicketDeepLinkDestination();
    }
    const prefix = '${AppRoutes.deepLinkTickets}/';
    if (raw.startsWith(prefix)) {
      return ClientTicketDeepLinkDestination(
        ticketNumber: _cleanTicket(raw.substring(prefix.length)),
      );
    }
    if (uri != null && uri.host == host && uri.pathSegments.isNotEmpty) {
      return ClientTicketDeepLinkDestination(
        ticketNumber: _cleanTicket(uri.pathSegments.first),
      );
    }
    return null;
  }

  static String initialRouteName(String defaultRouteName) =>
      parse(defaultRouteName) == null ? AppRoutes.splash : defaultRouteName;

  static String? _cleanTicket(String? value) {
    final clean = Uri.decodeComponent(value ?? '').trim();
    return clean.isEmpty ? null : clean;
  }
}
