import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_ticket_card.dart';

class HospitalDemoToolsScreen extends StatelessWidget {
  const HospitalDemoToolsScreen({
    required this.controller,
    required this.onLogout,
    super.key,
  });

  final HospitalController controller;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
    children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.science_outlined, color: hospitalTeal),
                  SizedBox(width: 8),
                  Text(
                    'Local demo controls',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                controller.session.displayName,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              Text(
                controller.session.loginId,
                style: const TextStyle(color: qpmsMuted),
              ),
              Text(
                '${controller.session.role.label} • ${controller.session.assignedBlock ?? 'All Blocks'}',
                style: const TextStyle(color: qpmsMuted),
              ),
              const SizedBox(height: 12),
              const Text(
                'Prototype data stays in memory and resets when the module restarts. No live API or database call is made.',
                style: TextStyle(fontSize: 12),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 12),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Client synchronization simulation',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 6),
              const Text(
                'Create a new complaint using the current role scope.',
                style: TextStyle(color: qpmsMuted, fontSize: 12),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: () => _create(context),
                    icon: const Icon(Icons.add_alert_outlined),
                    label: const Text('New complaint'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () =>
                        controller.advanceDemoTime(const Duration(minutes: 5)),
                    icon: const Icon(Icons.fast_forward),
                    label: const Text('Advance 5 min'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () =>
                        controller.advanceDemoTime(const Duration(minutes: 20)),
                    icon: const Icon(Icons.timer_off_outlined),
                    label: const Text('Advance 20 min'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () =>
                        controller.advanceDemoTime(const Duration(minutes: 30)),
                    icon: const Icon(Icons.warning_amber),
                    label: const Text('Advance 30 min'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Demo-only timer controls can escalate the same ticket without waiting for real SLA time.',
                style: TextStyle(
                  color: hospitalAmber,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 20),
      OutlinedButton.icon(
        onPressed: () async {
          final confirm = await showDialog<bool>(
            context: context,
            builder: (_) => AlertDialog(
              title: const Text('Log out of demo?'),
              content: const Text('Local ticket changes will be reset.'),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Logout'),
                ),
              ],
            ),
          );
          if (confirm == true) await onLogout();
        },
        icon: const Icon(Icons.logout),
        label: const Text('Logout'),
      ),
    ],
  );

  void _create(BuildContext context) {
    final ticket = controller.simulateNewClientComplaint(
      block: controller.session.assignedBlock ?? 'Block A',
    );
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('${ticket.id} created locally.')));
  }
}
