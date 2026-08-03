import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../features/auth/login_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/locations/locations_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/raise_ticket/raise_ticket_screen.dart';
import '../features/raise_ticket/ticket_submitted_screen.dart';
import '../features/splash/splash_screen.dart';
import '../features/tickets/my_tickets_screen.dart';
import '../features/tickets/ticket_details_screen.dart';
import '../features/tickets/feedback_screen.dart';
import '../state/auth_controller.dart';
import '../state/notification_controller.dart';
import '../state/ticket_controller.dart';
import '../services/client_push_service.dart';
import 'routes.dart';
import 'theme.dart';

class QpmsClientTicketingApp extends StatefulWidget {
  const QpmsClientTicketingApp({super.key});

  @override
  State<QpmsClientTicketingApp> createState() => _QpmsClientTicketingAppState();
}

class _QpmsClientTicketingAppState extends State<QpmsClientTicketingApp> {
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();
  StreamSubscription<ClientPushMessage>? _pushSubscription;

  @override
  void initState() {
    super.initState();
    _pushSubscription = ClientPushService.foregroundMessages.listen(
      _handlePush,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      for (final message in ClientPushService.takePendingMessages()) {
        _handlePush(message);
      }
    });
  }

  @override
  void dispose() {
    _pushSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthController()..load()),
        ChangeNotifierProvider(create: (_) => TicketController()),
        ChangeNotifierProvider(create: (_) => NotificationController()),
      ],
      child: MaterialApp(
        navigatorKey: _navigatorKey,
        title: 'QPMS Client Ticketing',
        debugShowCheckedModeBanner: false,
        theme: buildQpmsTheme(),
        initialRoute: AppRoutes.splash,
        routes: {
          AppRoutes.splash: (_) => const SplashScreen(),
          AppRoutes.login: (_) => const LoginScreen(),
          AppRoutes.dashboard: (_) => const DashboardScreen(),
          AppRoutes.raiseTicket: (_) => const RaiseTicketScreen(),
          AppRoutes.tickets: (_) => const MyTicketsScreen(),
          AppRoutes.notifications: (_) => const NotificationsScreen(),
          AppRoutes.profile: (_) => const ProfileScreen(),
          AppRoutes.locations: (_) => const LocationsScreen(),
          AppRoutes.about: (_) => const AboutScreen(),
        },
        onGenerateRoute: (settings) {
          if (settings.name == AppRoutes.ticketSubmitted) {
            return MaterialPageRoute(
              builder: (_) => TicketSubmittedScreen(
                ticketNumber: settings.arguments as String,
              ),
            );
          }
          if (settings.name == AppRoutes.ticketDetails) {
            return MaterialPageRoute(
              builder: (_) => TicketDetailsScreen(
                ticketNumber: settings.arguments as String,
              ),
            );
          }
          if (settings.name == AppRoutes.feedback) {
            return MaterialPageRoute(
              builder: (_) =>
                  FeedbackScreen(ticketNumber: settings.arguments as String),
            );
          }
          return null;
        },
      ),
    );
  }

  void _handlePush(ClientPushMessage message) {
    final context = _navigatorKey.currentContext;
    if (context == null) return;
    final ticketNumber = message.ticketNumber.isNotEmpty
        ? message.ticketNumber
        : message.ticketId;
    if (ticketNumber.isEmpty) return;
    unawaited(context.read<TicketController>().loadDetail(ticketNumber));
    unawaited(context.read<NotificationController>().load());
    if (message.openImmediately) {
      _openPushTicket(message, ticketNumber);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          message.body.isEmpty
              ? message.title
              : '${message.title}\n${message.body}',
        ),
        action: SnackBarAction(
          label: 'Open',
          onPressed: () => _openPushTicket(message, ticketNumber),
        ),
      ),
    );
  }

  void _openPushTicket(ClientPushMessage message, String ticketNumber) {
    _navigatorKey.currentState?.pushNamed(
      message.targetScreen == 'ticket_feedback'
          ? AppRoutes.feedback
          : AppRoutes.ticketDetails,
      arguments: ticketNumber,
    );
  }
}
