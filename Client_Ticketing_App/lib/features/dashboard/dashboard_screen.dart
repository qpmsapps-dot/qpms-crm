import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_drawer.dart';
import '../../core/widgets/logo_mark.dart';
import '../../core/widgets/ticket_card.dart';
import '../../models/ticket.dart';
import '../../state/notification_controller.dart';
import '../../state/ticket_controller.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tickets = context.watch<TicketController>();
    final notifications = context.watch<NotificationController>();
    return Scaffold(
      drawer: const QpmsDrawer(),
      appBar: AppBar(
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu_rounded),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            LogoMark(size: 34),
            SizedBox(width: 9),
            Text('QPMS Client Ticketing'),
          ],
        ),
        actions: [
          Badge(
            isLabelVisible: notifications.unreadCount > 0,
            label: Text('${notifications.unreadCount}'),
            child: IconButton(
              onPressed: () =>
                  Navigator.pushNamed(context, AppRoutes.notifications),
              icon: const Icon(Icons.notifications_none_rounded),
              tooltip: 'Notifications',
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([tickets.load(), notifications.load()]);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
            children: [
              const Text(
                'Good morning',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 3),
              const Text(
                'How can we help today?',
                style: TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w900,
                  color: AppColors.deepBlue,
                ),
              ),
              const SizedBox(height: 16),
              _RaiseComplaintCard(
                onTap: () =>
                    Navigator.pushNamed(context, AppRoutes.raiseTicket),
              ),
              const SizedBox(height: 18),
              const _SectionHeading(title: 'Ticket overview'),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _CountCard(
                      label: 'My Open Tickets',
                      value: tickets.openCount,
                      icon: Icons.pending_actions_rounded,
                      color: AppColors.orange,
                      onTap: () =>
                          Navigator.pushNamed(context, AppRoutes.tickets),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _CountCard(
                      label: 'My Closed Tickets',
                      value: tickets.closedCount,
                      icon: Icons.task_alt_rounded,
                      color: AppColors.green,
                      onTap: () =>
                          Navigator.pushNamed(context, AppRoutes.tickets),
                    ),
                  ),
                ],
              ),
              if (tickets.confirmationCount > 0) ...[
                const SizedBox(height: 10),
                InkWell(
                  onTap: () {
                    final ticket = tickets.tickets.firstWhere(
                      (item) =>
                          item.status == TicketStatus.awaitingConfirmation,
                    );
                    Navigator.pushNamed(
                      context,
                      AppRoutes.ticketDetails,
                      arguments: ticket.number,
                    );
                  },
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFECFDF5),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFA7F3D0)),
                    ),
                    child: Row(
                      children: [
                        const CircleAvatar(
                          backgroundColor: Colors.white,
                          child: Icon(
                            Icons.verified_rounded,
                            color: AppColors.green,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            '${tickets.confirmationCount} resolved complaint${tickets.confirmationCount == 1 ? '' : 's'} waiting for your confirmation',
                            style: const TextStyle(
                              fontSize: 12,
                              height: 1.35,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF166534),
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right_rounded,
                          color: AppColors.green,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 20),
              _SectionHeading(
                title: 'Recent updates',
                action: 'View all',
                onAction: () => Navigator.pushNamed(context, AppRoutes.tickets),
              ),
              const SizedBox(height: 10),
              for (final ticket in tickets.tickets.take(3))
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TicketCard(
                    ticket: ticket,
                    onTap: () => Navigator.pushNamed(
                      context,
                      AppRoutes.ticketDetails,
                      arguments: ticket.number,
                    ),
                  ),
                ),
              const SizedBox(height: 10),
              _SectionHeading(
                title: 'Alerts & notifications',
                action: 'View all',
                onAction: () =>
                    Navigator.pushNamed(context, AppRoutes.notifications),
              ),
              const SizedBox(height: 10),
              AppCard(
                child: Column(
                  children: [
                    for (final item in notifications.items.take(2))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 7),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 18,
                              backgroundColor: AppColors.paleBlue,
                              child: Icon(
                                item.iconKey == 'alert'
                                    ? Icons.priority_high_rounded
                                    : Icons.notifications_active_rounded,
                                size: 18,
                                color: item.iconKey == 'alert'
                                    ? AppColors.orange
                                    : AppColors.royalBlue,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.title,
                                    style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  Text(
                                    item.body,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AppColors.muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RaiseComplaintCard extends StatelessWidget {
  const _RaiseComplaintCard({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(22),
    child: Ink(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.deepBlue, AppColors.royalBlue],
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: AppColors.royalBlue.withValues(alpha: 0.22),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: const Row(
        children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: Colors.white,
            child: Icon(
              Icons.add_task_rounded,
              size: 29,
              color: AppColors.royalBlue,
            ),
          ),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Raise a Complaint',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                  ),
                ),
                SizedBox(height: 3),
                Text(
                  'Housekeeping help, right where you need it',
                  style: TextStyle(fontSize: 12, color: Color(0xFFDDEBFF)),
                ),
              ],
            ),
          ),
          Icon(Icons.arrow_forward_rounded, color: Colors.white),
        ],
      ),
    ),
  );
}

class _CountCard extends StatelessWidget {
  const _CountCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    required this.onTap,
  });
  final String label;
  final int value;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => AppCard(
    onTap: onTap,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.1),
          child: Icon(icon, color: color),
        ),
        const SizedBox(height: 14),
        Text(
          '$value',
          style: const TextStyle(
            fontSize: 27,
            fontWeight: FontWeight.w900,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            height: 1.25,
            fontWeight: FontWeight.w800,
            color: AppColors.muted,
          ),
        ),
      ],
    ),
  );
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title, this.action, this.onAction});
  final String title;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
      ),
      if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
    ],
  );
}
