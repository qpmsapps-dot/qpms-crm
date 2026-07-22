import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../models/notification_item.dart';
import '../../state/notification_controller.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<NotificationController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: controller.items.isEmpty
                ? null
                : () => context.read<NotificationController>().markAllRead(),
            child: const Text('Mark all as read'),
          ),
        ],
      ),
      bottomNavigationBar: const ClientBottomNav(
        currentRoute: AppRoutes.notifications,
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: controller.load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
            children: [
              if (controller.items.isEmpty)
                const _EmptyNotifications()
              else
                for (final item in controller.items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: AppCard(
                      onTap: item.ticketNumber == null
                          ? null
                          : () => Navigator.pushNamed(
                              context,
                              AppRoutes.ticketDetails,
                              arguments: item.ticketNumber,
                            ),
                      child: Row(
                        children: [
                          _NotificationIcon(item),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  item.title,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w900,
                                    color: AppColors.deepBlue,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  item.body,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  item.time,
                                  style: const TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (!item.isRead)
                            Container(
                              width: 9,
                              height: 9,
                              decoration: const BoxDecoration(
                                color: AppColors.royalBlue,
                                shape: BoxShape.circle,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyNotifications extends StatelessWidget {
  const _EmptyNotifications();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.only(top: 120),
    child: Column(
      children: [
        CircleAvatar(
          radius: 30,
          backgroundColor: AppColors.paleBlue,
          child: Icon(
            Icons.notifications_none_rounded,
            color: AppColors.royalBlue,
          ),
        ),
        SizedBox(height: 14),
        Text(
          'No Notifications',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        SizedBox(height: 5),
        Text(
          'Ticket updates will appear here.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
        ),
      ],
    ),
  );
}

class _NotificationIcon extends StatelessWidget {
  const _NotificationIcon(this.item);
  final NotificationItem item;

  @override
  Widget build(BuildContext context) {
    final data = switch (item.iconKey) {
      'person' => (Icons.engineering_rounded, AppColors.royalBlue),
      'work' => (Icons.build_circle_rounded, AppColors.orange),
      'comment' => (Icons.chat_bubble_rounded, AppColors.purple),
      'done' => (Icons.verified_rounded, AppColors.green),
      'closed' => (Icons.check_circle_rounded, AppColors.green),
      'alert' => (Icons.priority_high_rounded, AppColors.orange),
      _ => (Icons.confirmation_number_rounded, AppColors.orange),
    };
    return CircleAvatar(
      backgroundColor: data.$2.withValues(alpha: 0.12),
      child: Icon(data.$1, color: data.$2),
    );
  }
}
