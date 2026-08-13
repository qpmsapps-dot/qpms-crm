import 'package:flutter/material.dart';

import '../../app/routes.dart';
import '../constants/app_colors.dart';

class ClientBottomNav extends StatelessWidget {
  const ClientBottomNav({required this.currentRoute, super.key});

  final String currentRoute;

  @override
  Widget build(BuildContext context) {
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
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number_rounded),
            label: 'Tickets',
          ),
          NavigationDestination(
            icon: Icon(Icons.add_circle_outline_rounded, size: 30),
            selectedIcon: Icon(Icons.add_circle_rounded, size: 32),
            label: '',
          ),
          NavigationDestination(
            icon: Icon(Icons.notifications_none_rounded),
            selectedIcon: Icon(Icons.notifications_rounded),
            label: 'Notifications',
          ),
          NavigationDestination(
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
