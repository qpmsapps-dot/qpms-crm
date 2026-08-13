import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../constants/app_colors.dart';
import '../../state/notification_controller.dart';

class ClientBottomNav extends StatelessWidget {
  const ClientBottomNav({required this.currentRoute, super.key});

  final String currentRoute;

  @override
  Widget build(BuildContext context) {
    final unreadCount = context.watch<NotificationController>().unreadCount;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: AppColors.line)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 20,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: NavigationBar(
        selectedIndex: _indexFor(currentRoute),
        height: 72,
        elevation: 0,
        backgroundColor: Colors.white,
        indicatorColor: AppColors.paleBlue,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded),
            label: 'Home',
          ),
          const NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number_rounded),
            label: 'Tickets',
          ),
          const NavigationDestination(
            icon: Icon(Icons.add_circle_outline_rounded, size: 30),
            selectedIcon: Icon(Icons.add_circle_rounded, size: 32),
            label: '',
          ),
          NavigationDestination(
            icon: _NotificationNavIcon(
              icon: Icons.notifications_none_rounded,
              unreadCount: unreadCount,
            ),
            selectedIcon: _NotificationNavIcon(
              icon: Icons.notifications_rounded,
              unreadCount: unreadCount,
            ),
            label: 'Notifications',
          ),
          const NavigationDestination(
            icon: Icon(Icons.person_outline_rounded),
            selectedIcon: Icon(Icons.person_rounded),
            label: 'Profile',
          ),
        ],
        onDestinationSelected: (index) {
          if (index == 2) {
            Navigator.pushNamed(context, AppRoutes.raiseTicket);
            return;
          }
          final route = switch (index) {
            0 => AppRoutes.dashboard,
            1 => AppRoutes.tickets,
            3 => AppRoutes.notifications,
            _ => AppRoutes.profile,
          };
          if (route == currentRoute) return;
          Navigator.pushNamedAndRemoveUntil(context, route, (_) => false);
        },
      ),
    );
  }

  int _indexFor(String route) => switch (route) {
    AppRoutes.tickets => 1,
    AppRoutes.notifications => 3,
    AppRoutes.profile => 4,
    _ => 0,
  };
}

class _NotificationNavIcon extends StatelessWidget {
  const _NotificationNavIcon({required this.icon, required this.unreadCount});

  final IconData icon;
  final int unreadCount;

  @override
  Widget build(BuildContext context) {
    final label = unreadCount > 99 ? '99+' : '$unreadCount';
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Icon(icon),
        if (unreadCount > 0)
          Positioned(
            right: -8,
            top: -7,
            child: Container(
              constraints: const BoxConstraints(minWidth: 17, minHeight: 17),
              padding: const EdgeInsets.symmetric(horizontal: 4),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.red,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: Colors.white, width: 1.5),
              ),
              child: Text(
                label,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
