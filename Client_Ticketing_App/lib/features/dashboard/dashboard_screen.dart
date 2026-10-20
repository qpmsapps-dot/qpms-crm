import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
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
    final profileImage = _profileText(profile, const [
      'profile_image_url',
      'profile_image',
      'avatar_url',
      'photo_url',
    ], fallback: '');

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FC),
      bottomNavigationBar: const ClientBottomNav(
        currentRoute: AppRoutes.dashboard,
      ),
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([
              context.read<AuthController>().loadProfile(),
              tickets.load(),
              notifications.load(),
            ]);
          },
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              _HomeHero(
                profile: profile,
                userName: userName,
                profileImage: profileImage,
                unreadCount: notifications.unreadCount,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 30),
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
                      _RecentTicketsPanel(
                        tickets: tickets.tickets.take(2).toList(),
                        onTicketTap: (ticket) => Navigator.pushNamed(
                          context,
                          AppRoutes.ticketDetails,
                          arguments: ticket.number,
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

String _hospitalName(Map<String, dynamic>? profile) {
  final name = '${profile?['client_name'] ?? ''}'.trim();
  return name.isEmpty ? 'Hospital' : name;
}

String _hospitalShortName(Map<String, dynamic>? profile) {
  final shortName = '${profile?['client_short_name'] ?? ''}'.trim();
  return shortName.isEmpty ? _hospitalName(profile) : shortName;
}

Widget _hospitalImage(String url, BoxFit fit, Widget fallback) {
  final uri = Uri.tryParse(url);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return fallback;
  return Image.network(url, fit: fit, errorBuilder: (_, _, _) => fallback);
}

class _HomeHero extends StatelessWidget {
  const _HomeHero({
    required this.profile,
    required this.userName,
    required this.profileImage,
    required this.unreadCount,
  });

  final Map<String, dynamic>? profile;
  final String userName;
  final String profileImage;
  final int unreadCount;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
    child: Column(
      children: [
        _TopHeader(
          profile: profile,
          userName: userName,
          profileImage: profileImage,
          unreadCount: unreadCount,
        ),
        const SizedBox(height: 18),
        Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            boxShadow: [
              BoxShadow(
                color: AppColors.deepBlue.withValues(alpha: 0.14),
                blurRadius: 24,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: SizedBox(
              height: 178,
              width: double.infinity,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _hospitalImage(
                    '${profile?['client_banner_url'] ?? ''}',
                    BoxFit.cover,
                    Container(
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
                          AppColors.deepBlue.withValues(alpha: 0.86),
                          AppColors.royalBlue.withValues(alpha: 0.42),
                          Colors.transparent,
                        ],
                        stops: const [0, 0.48, 1],
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                      ),
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.fromLTRB(20, 0, 18, 18),
                    child: Align(
                      alignment: Alignment.bottomLeft,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.local_hospital_rounded,
                            color: Colors.white,
                            size: 24,
                          ),
                          const SizedBox(height: 10),
                          Text(
                            _hospitalName(profile),
                            maxLines: 2,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              height: 1.12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            _hospitalShortName(profile),
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
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
        ),
      ],
    ),
  );
}

class _TopHeader extends StatelessWidget {
  const _TopHeader({
    required this.profile,
    required this.userName,
    required this.profileImage,
    required this.unreadCount,
  });

  final Map<String, dynamic>? profile;
  final String userName;
  final String profileImage;
  final int unreadCount;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      ClipOval(
        child: Container(
          width: 42,
          height: 42,
          color: Colors.white,
          padding: const EdgeInsets.all(3),
          child: _hospitalImage(
            '${profile?['client_logo_url'] ?? ''}',
            BoxFit.contain,
            const Icon(
              Icons.local_hospital_rounded,
              color: AppColors.royalBlue,
              size: 24,
            ),
          ),
        ),
      ),
      const SizedBox(width: 10),
      Flexible(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _hospitalShortName(profile),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.deepBlue,
                fontSize: 19,
                fontWeight: FontWeight.w900,
                letterSpacing: 0,
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 9),
              child: Text(
                '|',
                style: TextStyle(
                  color: AppColors.muted,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Flexible(
              child: Text(
                'QPMS',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.royalBlue,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0,
                ),
              ),
            ),
          ],
        ),
      ),
      const SizedBox(width: 10),
      _HeaderIconButton(unreadCount: unreadCount),
      const SizedBox(width: 12),
      _ProfileAvatar(userName: userName, profileImage: profileImage),
    ],
  );
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({required this.unreadCount});

  final int unreadCount;

  @override
  Widget build(BuildContext context) => Badge(
    isLabelVisible: unreadCount > 0,
    label: Text(unreadCount > 99 ? '99+' : '$unreadCount'),
    child: InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => Navigator.pushNamed(context, AppRoutes.notifications),
      child: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.line),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 12,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: const Icon(
          Icons.notifications_none_rounded,
          color: AppColors.deepBlue,
          size: 23,
        ),
      ),
    ),
  );
}

class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({required this.userName, required this.profileImage});

  final String userName;
  final String profileImage;

  @override
  Widget build(BuildContext context) {
    final image = profileImage.trim();
    final fallback = Text(
      _initials(userName),
      style: const TextStyle(
        color: AppColors.deepBlue,
        fontWeight: FontWeight.w900,
      ),
    );
    Widget child = fallback;
    if (image.startsWith('http')) {
      child = Image.network(
        image,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => Center(child: fallback),
      );
    } else if (image.startsWith('assets/')) {
      child = Image.asset(
        image,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => Center(child: fallback),
      );
    }
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: () => Navigator.pushNamed(context, AppRoutes.profile),
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppColors.paleBlue,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 14,
              offset: const Offset(0, 7),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Center(child: child),
      ),
    );
  }
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
            fontSize: 19,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      if (action != null)
        TextButton(
          onPressed: onAction,
          style: TextButton.styleFrom(
            foregroundColor: AppColors.royalBlue,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 8),
          ),
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
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: constraints.maxWidth < 340 ? 1.28 : 1.4,
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
            color: const Color(0xFF0F9F9A),
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
    borderRadius: BorderRadius.circular(18),
    child: Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0F172A).withValues(alpha: 0.06),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const Spacer(),
              Text(
                '$value',
                style: const TextStyle(
                  color: AppColors.deepBlue,
                  fontSize: 30,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
            ],
          ),
          const Spacer(),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.deepBlue,
              fontSize: 13,
              height: 1.15,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: 1,
              minHeight: 3,
              color: color,
              backgroundColor: color.withValues(alpha: 0.11),
            ),
          ),
        ],
      ),
    ),
  );
}

class _RecentTicketsPanel extends StatelessWidget {
  const _RecentTicketsPanel({required this.tickets, required this.onTicketTap});

  final List<Ticket> tickets;
  final ValueChanged<Ticket> onTicketTap;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      boxShadow: [
        BoxShadow(
          color: const Color(0xFF0F172A).withValues(alpha: 0.06),
          blurRadius: 20,
          offset: const Offset(0, 10),
        ),
      ],
    ),
    child: Column(
      children: [
        for (var index = 0; index < tickets.length; index++) ...[
          _RecentTicketCard(
            ticket: tickets[index],
            onTap: () => onTicketTap(tickets[index]),
          ),
          if (index != tickets.length - 1)
            const Divider(height: 1, indent: 76, color: AppColors.line),
        ],
      ],
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
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            _RecentTicketPhoto(ticket: ticket),
            const SizedBox(width: 13),
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
                      fontSize: 12,
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
                      height: 1.1,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 7),
                  _MetaText(
                    icon: Icons.location_on_outlined,
                    text: ticket.conciseLocation,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 112),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _StatusPill(
                    color: color,
                    label: _clientStatusLabel(ticket.status),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          _compactTicketTime(ticket.raisedAt),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.chevron_right_rounded,
                        color: AppColors.muted,
                        size: 18,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.11),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      label,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        color: color,
        fontSize: 10.5,
        fontWeight: FontWeight.w900,
      ),
    ),
  );
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
      Flexible(
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
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(width: 50, height: 50, child: child),
    );
  }
}

class _PhotoFallback extends StatelessWidget {
  const _PhotoFallback();

  @override
  Widget build(BuildContext context) => Container(
    color: const Color(0xFFF1F5F9),
    child: const Center(
      child: Icon(Icons.cleaning_services_outlined, color: AppColors.muted),
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
  TicketStatus.open => 'Open',
  TicketStatus.assigned => 'Team Assigned',
  TicketStatus.accepted || TicketStatus.inProgress => 'In Progress',
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.escalatedProjectHead ||
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
  if (sameDay) return _clock(value);
  final yesterday = now.subtract(const Duration(days: 1));
  if (yesterday.year == value.year &&
      yesterday.month == value.month &&
      yesterday.day == value.day) {
    return 'Yesterday';
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
  return '${months[value.month - 1]} ${value.day}';
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
