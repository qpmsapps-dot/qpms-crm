import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_assets.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_drawer.dart';
import '../../core/widgets/section_header.dart';
import '../../core/widgets/ticket_card.dart';
import '../../state/notification_controller.dart';
import '../../state/ticket_controller.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tickets = context.watch<TicketController>().tickets;
    final unread = context.watch<NotificationController>().unreadCount;
    return Scaffold(
      drawer: const QpmsDrawer(),
      appBar: AppBar(
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu_rounded),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
        title: const Text(''),
        actions: [
          Stack(
            alignment: Alignment.topRight,
            children: [
              IconButton(
                onPressed: () =>
                    Navigator.pushNamed(context, AppRoutes.notifications),
                icon: const Icon(Icons.notifications_none_rounded),
              ),
              if (unread > 0)
                Container(
                  margin: const EdgeInsets.only(top: 8, right: 8),
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    color: AppColors.red,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '$unread',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
          children: [
            const Text(
              'Hello, Vigneshwar 👋',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                color: AppColors.deepBlue,
              ),
            ),
            const Text(
              'Good morning!',
              style: TextStyle(
                color: AppColors.muted,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(24),
              child: SvgPicture.asset(
                AppAssets.facilityBanner,
                height: 150,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 18),
            const SectionHeader(title: 'Ticket Summary'),
            GridView.count(
              crossAxisCount: 4,
              crossAxisSpacing: 8,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 0.78,
              children: const [
                _SummaryCard(
                  label: 'Open',
                  value: '12',
                  color: AppColors.royalBlue,
                ),
                _SummaryCard(
                  label: 'In Progress',
                  value: '5',
                  color: AppColors.orange,
                ),
                _SummaryCard(
                  label: 'On Hold',
                  value: '2',
                  color: AppColors.purple,
                ),
                _SummaryCard(
                  label: 'Closed',
                  value: '18',
                  color: AppColors.green,
                ),
              ],
            ),
            const SizedBox(height: 14),
            const SectionHeader(title: 'Quick Actions'),
            GridView.count(
              crossAxisCount: 4,
              crossAxisSpacing: 8,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 0.82,
              children: [
                _ActionCard(
                  icon: Icons.add_circle_rounded,
                  label: 'Raise Ticket',
                  onTap: () =>
                      Navigator.pushNamed(context, AppRoutes.raiseTicket),
                ),
                _ActionCard(
                  icon: Icons.list_alt_rounded,
                  label: 'My Tickets',
                  onTap: () => Navigator.pushNamed(context, AppRoutes.tickets),
                ),
                _ActionCard(
                  icon: Icons.location_on_rounded,
                  label: 'Site / Location',
                  onTap: () =>
                      Navigator.pushNamed(context, AppRoutes.locations),
                ),
                _ActionCard(
                  icon: Icons.campaign_rounded,
                  label: 'Announcements',
                  onTap: () => _announcement(context),
                ),
              ],
            ),
            const SizedBox(height: 18),
            SectionHeader(
              title: 'Recent Tickets',
              actionLabel: 'View All',
              onAction: () => Navigator.pushNamed(context, AppRoutes.tickets),
            ),
            ...tickets
                .take(3)
                .map(
                  (ticket) => Padding(
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
                ),
          ],
        ),
      ),
    );
  }

  void _announcement(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Announcements'),
        content: const Text(
          'Announcements will be published here in the production version.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.w900,
              fontSize: 21,
              color: color,
            ),
          ),
          const SizedBox(height: 3),
          FittedBox(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: AppColors.royalBlue, size: 26),
          const SizedBox(height: 6),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}
