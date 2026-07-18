import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_ticket_card.dart';

class HospitalNotificationsScreen extends StatelessWidget {
  const HospitalNotificationsScreen({required this.controller, super.key});
  final HospitalController controller;

  @override
  Widget build(BuildContext context) {
    if (controller.notifications.isEmpty) {
      return RefreshIndicator(
        onRefresh: controller.load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 240),
            Center(
              child: Text(
                'No housekeeping notifications.',
                style: TextStyle(color: qpmsMuted),
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: controller.load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
        itemCount: controller.notifications.length,
        separatorBuilder: (_, _) => const SizedBox(height: 9),
        itemBuilder: (_, index) {
          final item = controller.notifications[index];
          final created = DateTime.tryParse(
            '${item['created_at'] ?? ''}',
          )?.toLocal();
          final unread = item['read_at'] == null;
          return Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: hospitalTeal.withValues(alpha: .1),
                child: const Icon(
                  Icons.notifications_active_outlined,
                  color: hospitalTeal,
                ),
              ),
              title: Text(
                '${item['title'] ?? 'Ticket update'}',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: Text(
                '${item['body'] ?? ''}${created == null ? '' : '\n${DateFormat('dd MMM, hh:mm a').format(created)}'}',
              ),
              trailing: unread
                  ? const Icon(Icons.circle, size: 10, color: hospitalTeal)
                  : null,
              onTap: unread
                  ? () => controller.markNotificationRead('${item['id']}')
                  : null,
            ),
          );
        },
      ),
    );
  }
}
