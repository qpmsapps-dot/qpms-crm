import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../core/widgets/client_ui.dart';
import '../../models/notification_item.dart';
import '../../state/notification_controller.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _unreadOnly = false;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<NotificationController>();
    final items = _unreadOnly
        ? controller.items.where((item) => !item.isRead).toList()
        : controller.items;
    final groups = _groupNotifications(items);
    final showMarkAll = controller.unreadCount > 0;

    return Scaffold(
      backgroundColor: AppColors.screenBg,
      bottomNavigationBar: const ClientBottomNav(
        currentRoute: AppRoutes.notifications,
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: controller.load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const Expanded(
                    child: Text(
                      'Notifications',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: showMarkAll
                        ? () => context
                              .read<NotificationController>()
                              .markAllRead()
                        : null,
                    child: const Text('Mark all read'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _NotificationFilter(
                unreadOnly: _unreadOnly,
                onChanged: (value) => setState(() => _unreadOnly = value),
              ),
              const SizedBox(height: 16),
              if (controller.isLoading && controller.items.isEmpty)
                const _NotificationSkeleton()
              else if (controller.errorMessage != null &&
                  controller.items.isEmpty)
                _NotificationError(
                  message: controller.errorMessage!,
                  onRetry: () => context.read<NotificationController>().load(),
                )
              else if (items.isEmpty)
                _EmptyNotifications(unreadOnly: _unreadOnly)
              else ...[
                if (controller.errorMessage != null)
                  _InlineError(message: controller.errorMessage!),
                for (final entry in groups.entries) ...[
                  _GroupHeading(entry.key),
                  for (final item in entry.value)
                    _NotificationRow(
                      item: item,
                      onTap: () => _openNotification(context, item),
                    ),
                  const SizedBox(height: 6),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openNotification(
    BuildContext context,
    NotificationItem item,
  ) async {
    final navigator = Navigator.of(context);
    try {
      await context.read<NotificationController>().markRead(item);
    } catch (_) {
      // Ticket navigation is still useful if read-state sync fails.
    }
    final identifier = item.ticketNumber ?? item.ticketId;
    if (identifier == null || identifier.isEmpty) return;
    navigator.pushNamed(AppRoutes.ticketDetails, arguments: identifier);
  }
}

class _NotificationFilter extends StatelessWidget {
  const _NotificationFilter({
    required this.unreadOnly,
    required this.onChanged,
  });

  final bool unreadOnly;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _FilterPill(
          label: 'All',
          selected: !unreadOnly,
          onTap: () => onChanged(false),
        ),
        const SizedBox(width: 8),
        _FilterPill(
          label: 'Unread',
          selected: unreadOnly,
          onTap: () => onChanged(true),
        ),
      ],
    );
  }
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? AppColors.royalBlue : Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected ? AppColors.royalBlue : AppColors.line,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w800,
            color: selected ? Colors.white : AppColors.ink,
          ),
        ),
      ),
    );
  }
}

class _GroupHeading extends StatelessWidget {
  const _GroupHeading(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8, bottom: 8),
    child: Text(
      label.toUpperCase(),
      style: const TextStyle(
        color: AppColors.muted,
        fontSize: 12,
        fontWeight: FontWeight.w900,
        letterSpacing: 0,
      ),
    ),
  );
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.item, required this.onTap});

  final NotificationItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hasTarget =
        (item.ticketNumber != null && item.ticketNumber!.isNotEmpty) ||
        (item.ticketId != null && item.ticketId!.isNotEmpty);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: item.isRead ? Colors.white : AppColors.paleBlue,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: hasTarget ? onTap : null,
          child: Container(
            constraints: const BoxConstraints(minHeight: 82),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.line),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.035),
                  blurRadius: 14,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _NotificationThumb(item),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              item.title.isEmpty ? 'Ticket update' : item.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: item.isRead
                                    ? FontWeight.w800
                                    : FontWeight.w900,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                          if (!item.isRead) ...[
                            const SizedBox(width: 8),
                            const _UnreadDot(),
                          ],
                        ],
                      ),
                      if (item.ticketNumber != null) ...[
                        const SizedBox(height: 3),
                        Text(
                          item.ticketNumber!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.deepBlue,
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                      if (item.body.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          item.body,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            height: 1.3,
                            color: AppColors.muted,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            item.time,
                            style: const TextStyle(
                              color: AppColors.muted,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          if (item.isActionRequired)
                            const _ActionRequiredChip(),
                        ],
                      ),
                    ],
                  ),
                ),
                if (item.isActionRequired && hasTarget) ...[
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppColors.royalBlue,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NotificationThumb extends StatelessWidget {
  const _NotificationThumb(this.item);
  final NotificationItem item;

  @override
  Widget build(BuildContext context) {
    final imageUrl = item.beforeImageUrl;
    if (imageUrl != null && imageUrl.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(
          imageUrl,
          width: 54,
          height: 54,
          fit: BoxFit.cover,
          excludeFromSemantics: true,
          errorBuilder: (context, error, stackTrace) => _IconThumb(item),
          loadingBuilder: (context, child, progress) {
            if (progress == null) return child;
            return const _ThumbPlaceholder();
          },
        ),
      );
    }
    return _IconThumb(item);
  }
}

class _IconThumb extends StatelessWidget {
  const _IconThumb(this.item);
  final NotificationItem item;

  @override
  Widget build(BuildContext context) {
    final data = switch (item.iconKey) {
      'ticket_created' => (Icons.confirmation_number_rounded, AppColors.green),
      'ticket_accepted' => (Icons.verified_rounded, AppColors.royalBlue),
      'work_started' => (Icons.build_circle_rounded, AppColors.orange),
      'awaiting_confirmation' => (Icons.rate_review_rounded, AppColors.green),
      'ticket_reopened_client' => (Icons.replay_rounded, AppColors.orange),
      'ticket_cancelled' => (Icons.cancel_outlined, AppColors.red),
      _ => (Icons.photo_outlined, AppColors.muted),
    };
    return Container(
      width: 54,
      height: 54,
      decoration: BoxDecoration(
        color: data.$2.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Icon(data.$1, color: data.$2),
    );
  }
}

class _ThumbPlaceholder extends StatelessWidget {
  const _ThumbPlaceholder();

  @override
  Widget build(BuildContext context) => Container(
    width: 54,
    height: 54,
    decoration: BoxDecoration(
      color: AppColors.softSurface,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.line),
    ),
  );
}

class _UnreadDot extends StatelessWidget {
  const _UnreadDot();

  @override
  Widget build(BuildContext context) => Container(
    width: 9,
    height: 9,
    margin: const EdgeInsets.only(top: 5),
    decoration: const BoxDecoration(
      color: AppColors.royalBlue,
      shape: BoxShape.circle,
    ),
  );
}

class _ActionRequiredChip extends StatelessWidget {
  const _ActionRequiredChip();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: AppColors.greenSoft,
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: AppColors.green.withValues(alpha: 0.25)),
    ),
    child: const Text(
      'Action Required',
      style: TextStyle(
        color: AppColors.green,
        fontSize: 11,
        fontWeight: FontWeight.w900,
      ),
    ),
  );
}

class _NotificationSkeleton extends StatelessWidget {
  const _NotificationSkeleton();

  @override
  Widget build(BuildContext context) => Column(
    children: List.generate(
      5,
      (index) => Container(
        height: 84,
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.82),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.line),
        ),
      ),
    ),
  );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: AppColors.amberSoft,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppColors.orange.withValues(alpha: 0.22)),
    ),
    child: Text(
      message,
      style: const TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700),
    ),
  );
}

class _NotificationError extends StatelessWidget {
  const _NotificationError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 90),
    child: Column(
      children: [
        ClientEmptyState(
          icon: Icons.wifi_off_rounded,
          title: message,
          message: 'Check your connection and try again.',
        ),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
      ],
    ),
  );
}

class _EmptyNotifications extends StatelessWidget {
  const _EmptyNotifications({required this.unreadOnly});
  final bool unreadOnly;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 90),
    child: ClientEmptyState(
      icon: Icons.notifications_none_rounded,
      title: unreadOnly ? "You're all caught up" : 'No notifications yet',
      message: unreadOnly
          ? 'No unread notifications.'
          : 'Ticket updates will appear here.',
    ),
  );
}

Map<String, List<NotificationItem>> _groupNotifications(
  List<NotificationItem> items,
) {
  final groups = <String, List<NotificationItem>>{};
  for (final item in items) {
    final label = _groupLabel(item.createdAt);
    groups.putIfAbsent(label, () => <NotificationItem>[]).add(item);
  }
  return groups;
}

String _groupLabel(DateTime? value) {
  if (value == null) return 'Earlier';
  final now = DateTime.now();
  if (_sameDate(now, value)) return 'Today';
  final yesterday = now.subtract(const Duration(days: 1));
  if (_sameDate(yesterday, value)) return 'Yesterday';
  return 'Earlier';
}

bool _sameDate(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;
