import 'package:flutter/material.dart';

import '../../app/routes.dart';
import '../constants/app_colors.dart';

class ClientBottomNav extends StatelessWidget {
  const ClientBottomNav({required this.currentRoute, super.key});

  final String currentRoute;

  @override
  Widget build(BuildContext context) {
    return NavigationBar(
      selectedIndex: _indexFor(currentRoute),
      height: 70,
      backgroundColor: Colors.white,
      indicatorColor: AppColors.paleBlue,
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home_rounded),
          label: 'Home',
        ),
        NavigationDestination(
          icon: Icon(Icons.confirmation_number_outlined),
          selectedIcon: Icon(Icons.confirmation_number_rounded),
          label: 'Complaints',
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
        final route = switch (index) {
          0 => AppRoutes.dashboard,
          1 => AppRoutes.tickets,
          2 => AppRoutes.notifications,
          _ => AppRoutes.profile,
        };
        if (route == currentRoute) return;
        Navigator.pushNamedAndRemoveUntil(context, route, (_) => false);
      },
    );
  }

  int _indexFor(String route) => switch (route) {
    AppRoutes.tickets => 1,
    AppRoutes.notifications => 2,
    AppRoutes.profile => 3,
    _ => 0,
  };
}
