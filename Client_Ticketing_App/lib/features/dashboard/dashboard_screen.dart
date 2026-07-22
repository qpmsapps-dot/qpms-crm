import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../core/widgets/logo_mark.dart';
import '../../core/widgets/ticket_card.dart';
import '../../state/auth_controller.dart';
import '../../state/notification_controller.dart';
import '../../state/ticket_controller.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tickets = context.watch<TicketController>();
    final notifications = context.watch<NotificationController>();
    final profile = context.watch<AuthController>().profile;
    final userName = _profileText(profile, const [
      'display_name',
      'full_name',
      'name',
      'email',
    ], fallback: 'Client user');
    final clientName = _profileText(profile, const [
      'client_name',
      'hospital_client_name',
      'site_name',
    ], fallback: 'Client Ticketing');
    return Scaffold(
      bottomNavigationBar: const ClientBottomNav(
        currentRoute: AppRoutes.dashboard,
      ),
      appBar: AppBar(
        title: const Text('Home'),
        leadingWidth: 68,
        leading: const Padding(
          padding: EdgeInsets.only(left: 18),
          child: LogoMark(size: 38),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Badge(
              isLabelVisible: notifications.unreadCount > 0,
              label: Text('${notifications.unreadCount}'),
              child: IconButton.filledTonal(
                onPressed: () =>
                    Navigator.pushNamed(context, AppRoutes.notifications),
                icon: const Icon(Icons.notifications_none_rounded),
                tooltip: 'Notifications',
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([tickets.load(), notifications.load()]);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
            children: [
              Text(
                'Hello,',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                userName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  color: AppColors.deepBlue,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                clientName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 16),
              _RaiseComplaintCard(
                onTap: () =>
                    Navigator.pushNamed(context, AppRoutes.raiseTicket),
              ),
              const SizedBox(height: 18),
              const _SectionHeading(title: 'Overview'),
              const SizedBox(height: 10),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                childAspectRatio: 1.5,
                children: [
                  _CountCard(
                    label: 'Open',
                    value: tickets.openCount,
                    icon: Icons.pending_actions_rounded,
                    color: AppColors.orange,
                    onTap: () =>
                        Navigator.pushNamed(context, AppRoutes.tickets),
                  ),
                  _CountCard(
                    label: 'In Progress',
                    value: tickets.inProgressCount,
                    icon: Icons.build_circle_rounded,
                    color: AppColors.royalBlue,
                    onTap: () =>
                        Navigator.pushNamed(context, AppRoutes.tickets),
                  ),
                  _CountCard(
                    label: 'Awaiting Confirmation',
                    value: tickets.confirmationCount,
                    icon: Icons.verified_rounded,
                    color: AppColors.orange,
                    onTap: () =>
                        Navigator.pushNamed(context, AppRoutes.tickets),
                  ),
                  _CountCard(
                    label: 'Closed',
                    value: tickets.closedCount,
                    icon: Icons.task_alt_rounded,
                    color: AppColors.green,
                    onTap: () =>
                        Navigator.pushNamed(context, AppRoutes.tickets),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              _SectionHeading(
                title: 'Recent complaints',
                action: 'View All',
                onAction: () => Navigator.pushNamed(context, AppRoutes.tickets),
              ),
              const SizedBox(height: 10),
              if (tickets.tickets.isEmpty)
                _EmptyHomeCard(
                  onTap: () =>
                      Navigator.pushNamed(context, AppRoutes.raiseTicket),
                )
              else
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
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyHomeCard extends StatelessWidget {
  const _EmptyHomeCard({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      children: [
        const CircleAvatar(
          backgroundColor: AppColors.paleBlue,
          child: Icon(Icons.fact_check_outlined, color: AppColors.royalBlue),
        ),
        const SizedBox(height: 12),
        const Text(
          'No Complaints Yet',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 5),
        const Text(
          'You have no complaints in your authorised scope.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: onTap,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Raise Complaint'),
        ),
      ],
    ),
  );
}

String _profileText(
  Map<String, dynamic>? profile,
  List<String> keys, {
  required String fallback,
}) {
  for (final key in keys) {
    final text = '${profile?[key] ?? ''}'.trim();
    if (text.isNotEmpty && text != 'null') return text;
  }
  return fallback;
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
