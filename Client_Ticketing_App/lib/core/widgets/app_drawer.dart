import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../state/auth_controller.dart';
import '../constants/app_colors.dart';
import 'logo_mark.dart';

class QpmsDrawer extends StatelessWidget {
  const QpmsDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: Colors.white,
      child: SafeArea(
        child: Column(
          children: [
            const Padding(
              padding: EdgeInsets.all(20),
              child: Row(
                children: [
                  LogoMark(size: 54),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'QPMS',
                          style: TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 24,
                            color: AppColors.deepBlue,
                          ),
                        ),
                        Text(
                          'Hospital Client User',
                          style: TextStyle(color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            _item(
              context,
              Icons.dashboard_rounded,
              'Dashboard',
              AppRoutes.dashboard,
            ),
            _item(
              context,
              Icons.add_circle_rounded,
              'Raise Complaint',
              AppRoutes.raiseTicket,
            ),
            _item(
              context,
              Icons.confirmation_number_rounded,
              'NIMS Tickets',
              AppRoutes.tickets,
            ),
            _item(
              context,
              Icons.notifications_rounded,
              'Notifications',
              AppRoutes.notifications,
            ),
            _item(
              context,
              Icons.location_on_rounded,
              'Blocks / Locations',
              AppRoutes.locations,
            ),
            _item(context, Icons.info_rounded, 'About QPMS', AppRoutes.about),
            const Spacer(),
            ListTile(
              leading: const Icon(Icons.logout_rounded, color: AppColors.red),
              title: const Text(
                'Logout',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              onTap: () => _confirmLogout(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _item(
    BuildContext context,
    IconData icon,
    String label,
    String route,
  ) {
    return ListTile(
      leading: Icon(icon, color: AppColors.royalBlue),
      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
      onTap: () {
        Navigator.pop(context);
        Navigator.pushNamedAndRemoveUntil(
          context,
          route,
          (r) => route == AppRoutes.dashboard ? false : r.isFirst,
        );
      },
    );
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Logout?'),
        content: const Text('This will return to the login screen.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await context.read<AuthController>().logout();
    if (!context.mounted) return;
    Navigator.pushNamedAndRemoveUntil(context, AppRoutes.login, (_) => false);
  }
}
