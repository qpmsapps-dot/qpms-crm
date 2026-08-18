import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_assets.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../models/ticket.dart';
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
    ], fallback: 'Client User');

    return Scaffold(
      backgroundColor: const Color(0xFFF7FAFF),
      bottomNavigationBar: const ClientBottomNav(
        currentRoute: AppRoutes.dashboard,
      ),
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([tickets.load(), notifications.load()]);
          },
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              _HomeHero(
                userName: userName,
                unreadCount: notifications.unreadCount,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _SectionHeader(
                      title: 'Ticket Summary',
                      action: 'View all',
                      onAction: () =>
                          Navigator.pushNamed(context, AppRoutes.tickets),
                    ),
                    const SizedBox(height: 12),
                    _SummaryGrid(tickets: tickets),
                    const SizedBox(height: 24),
                    _SectionHeader(
                      title: 'Recent Tickets',
                      action: 'View all',
                      onAction: () =>
                          Navigator.pushNamed(context, AppRoutes.tickets),
                    ),
                    const SizedBox(height: 12),
                    if (tickets.tickets.isEmpty)
                      const _EmptyHomeCard()
                    else
                      for (final ticket in tickets.tickets.take(5))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _RecentTicketCard(
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
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeHero extends StatelessWidget {
  const _HomeHero({required this.userName, required this.unreadCount});

  final String userName;
  final int unreadCount;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
    child: Column(
      children: [
        _TopHeader(userName: userName, unreadCount: unreadCount),
        const SizedBox(height: 14),
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: SizedBox(
            height: 146,
            width: double.infinity,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(
                  AppAssets.nimsHospitalHome,
                  fit: BoxFit.cover,
                  alignment: Alignment.topCenter,
                  errorBuilder: (_, _, _) => Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFFEFF6FF), Color(0xFFDDEBFF)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                    child: const Icon(
                      Icons.local_hospital_rounded,
                      color: AppColors.royalBlue,
                      size: 48,
                    ),
                  ),
                ),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.black.withValues(alpha: 0.32),
                        Colors.black.withValues(alpha: 0.05),
                      ],
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class _TopHeader extends StatelessWidget {
  const _TopHeader({required this.userName, required this.unreadCount});

  final String userName;
  final int unreadCount;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      const Expanded(child: _CollaborationBadge()),
      Badge(
        isLabelVisible: unreadCount > 0,
        label: Text('$unreadCount'),
        child: IconButton(
          onPressed: () =>
              Navigator.pushNamed(context, AppRoutes.notifications),
          icon: const Icon(Icons.notifications_none_rounded),
          color: AppColors.deepBlue,
          iconSize: 28,
          tooltip: 'Notifications',
        ),
      ),
      const SizedBox(width: 12),
      CircleAvatar(
        radius: 26,
        backgroundColor: AppColors.paleBlue,
        child: Text(
          _initials(userName),
          style: const TextStyle(
            color: AppColors.deepBlue,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    ],
  );
}

class _CollaborationBadge extends StatelessWidget {
  const _CollaborationBadge();

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(maxWidth: 300),
    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.94),
      borderRadius: BorderRadius.circular(19),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.1),
          blurRadius: 18,
          offset: const Offset(0, 8),
        ),
      ],
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipOval(
          child: Image.asset(
            AppAssets.nimsLogo,
            width: 38,
            height: 38,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => const Icon(
              Icons.local_hospital_rounded,
              color: AppColors.royalBlue,
              size: 32,
            ),
          ),
        ),
        const SizedBox(width: 8),
        const Text(
          'NIMS',
          style: TextStyle(
            color: AppColors.deepBlue,
            fontSize: 16,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(width: 18),
        Flexible(
          child: SizedBox(
            width: 94,
            height: 30,
            child: Image.asset(
              'assets/Images/qpms_logo.png',
              fit: BoxFit.contain,
              alignment: Alignment.centerLeft,
            ),
          ),
        ),
      ],
    ),
  );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.action, this.onAction});

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
            color: AppColors.deepBlue,
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      if (action != null)
        TextButton(
          onPressed: onAction,
          child: Text(
            action!,
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
    ],
  );
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.tickets});

  final TicketController tickets;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      return GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisSpacing: 14,
        mainAxisSpacing: 14,
        childAspectRatio: constraints.maxWidth < 340 ? 1.44 : 1.52,
        children: [
          _CountCard(
            label: 'Open',
            value: tickets.openCount,
            icon: Icons.pending_actions_rounded,
            color: AppColors.orange,
            onTap: () => Navigator.pushNamed(context, AppRoutes.tickets),
          ),
          _CountCard(
            label: 'In Progress',
            value: tickets.inProgressCount,
            icon: Icons.schedule_rounded,
            color: AppColors.royalBlue,
            onTap: () => Navigator.pushNamed(context, AppRoutes.tickets),
          ),
          _CountCard(
            label: 'Work Completed',
            value: tickets.confirmationCount,
            icon: Icons.verified_rounded,
            color: AppColors.green,
            onTap: () => Navigator.pushNamed(context, AppRoutes.tickets),
          ),
          _CountCard(
            label: 'Closed',
            value: tickets.closedCount,
            icon: Icons.task_alt_rounded,
            color: const Color(0xFF14B8A6),
            onTap: () => Navigator.pushNamed(context, AppRoutes.tickets),
          ),
        ],
      );
    },
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
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(20),
    child: Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.line),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Expanded(
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: color, size: 26),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '$value',
                        style: TextStyle(
                          color: color,
                          fontSize: 30,
                          fontWeight: FontWeight.w900,
                          height: 1,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.deepBlue,
                          fontSize: 14,
                          height: 1.15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Container(
            height: 4,
            width: double.infinity,
            decoration: BoxDecoration(
              color: color,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(99),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _RecentTicketCard extends StatelessWidget {
  const _RecentTicketCard({required this.ticket, required this.onTap});

  final Ticket ticket;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(ticket.status);
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _RecentTicketPhoto(ticket: ticket),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ticket.number,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.royalBlue,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  clientServiceLabel(ticket.category),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.deepBlue,
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                if (ticket.description.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    ticket.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 10,
                  runSpacing: 4,
                  children: [
                    _MetaText(
                      icon: Icons.location_on_outlined,
                      text: ticket.conciseLocation,
                    ),
                    _MetaText(
                      icon: Icons.calendar_month_outlined,
                      text: _compactTicketTime(ticket.raisedAt),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              _clientStatusLabel(ticket.status),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaText extends StatelessWidget {
  const _MetaText({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 15, color: AppColors.muted),
      const SizedBox(width: 4),
      ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 145),
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    ],
  );
}

class _RecentTicketPhoto extends StatelessWidget {
  const _RecentTicketPhoto({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final photo = ticket.complaintPhotoAssets.isNotEmpty
        ? ticket.complaintPhotoAssets.first.trim()
        : '';
    const fallback = _PhotoFallback();
    Widget child = fallback;
    if (photo.startsWith('http')) {
      child = Image.network(
        photo,
        fit: BoxFit.cover,
        loadingBuilder: (context, image, loading) =>
            loading == null ? image : fallback,
        errorBuilder: (_, _, _) => fallback,
      );
    } else if (photo.startsWith('assets/')) {
      child = Image.asset(
        photo,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
      );
    } else if (photo.isNotEmpty) {
      child = Image.file(
        File(photo),
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(width: 62, height: 62, child: child),
    );
  }
}

class _PhotoFallback extends StatelessWidget {
  const _PhotoFallback();

  @override
  Widget build(BuildContext context) => Container(
    color: const Color(0xFFF1F5F9),
    child: const Center(
      child: Icon(Icons.image_outlined, color: AppColors.muted),
    ),
  );
}

class _EmptyHomeCard extends StatelessWidget {
  const _EmptyHomeCard();

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      children: [
        const CircleAvatar(
          backgroundColor: AppColors.paleBlue,
          child: Icon(
            Icons.confirmation_number_outlined,
            color: AppColors.royalBlue,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'No open tickets',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 5),
        const Text(
          'Everything is currently up to date.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
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

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+|@'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'CL';
  return parts.take(2).map((part) => part.substring(0, 1)).join().toUpperCase();
}

String _clientStatusLabel(TicketStatus status) => switch (status) {
  TicketStatus.open => 'Ticket Received',
  TicketStatus.assigned => 'Team Assigned',
  TicketStatus.accepted || TicketStatus.inProgress => 'In Progress',
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened => 'In Progress',
  TicketStatus.awaitingConfirmation => 'Work Completed',
  TicketStatus.closed => 'Closed',
  TicketStatus.cancelled => 'Cancelled',
};

Color _statusColor(TicketStatus status) => switch (status) {
  TicketStatus.awaitingConfirmation || TicketStatus.closed => AppColors.green,
  TicketStatus.cancelled => AppColors.muted,
  TicketStatus.open || TicketStatus.assigned => AppColors.orange,
  _ => AppColors.royalBlue,
};

String _compactTicketTime(DateTime value) {
  final now = DateTime.now();
  final sameDay =
      now.year == value.year &&
      now.month == value.month &&
      now.day == value.day;
  if (sameDay) return 'Today, ${_clock(value)}';
  final yesterday = now.subtract(const Duration(days: 1));
  if (yesterday.year == value.year &&
      yesterday.month == value.month &&
      yesterday.day == value.day) {
    return 'Yesterday, ${_clock(value)}';
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${months[value.month - 1]} ${value.day}, ${_clock(value)}';
}

String _clock(DateTime value) {
  final hour = value.hour == 0
      ? 12
      : value.hour > 12
      ? value.hour - 12
      : value.hour;
  final minute = value.minute.toString().padLeft(2, '0');
  final period = value.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $period';
}
