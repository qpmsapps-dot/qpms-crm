import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/chips.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../core/widgets/client_ui.dart';
import '../../core/widgets/logo_mark.dart';
import '../../models/ticket.dart';
import '../../models/ticket_update.dart';
import '../../state/ticket_controller.dart';
import '../../state/auth_controller.dart';

class TicketDetailsScreen extends StatefulWidget {
  const TicketDetailsScreen({required this.ticketNumber, super.key});
  final String ticketNumber;

  @override
  State<TicketDetailsScreen> createState() => _TicketDetailsScreenState();
}

class _TicketDetailsScreenState extends State<TicketDetailsScreen>
    with WidgetsBindingObserver {
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    context.read<TicketController>().resolveTicket(widget.ticketNumber);
    _startPolling();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted || !context.read<AuthController>().isAuthenticated) {
        _pollTimer?.cancel();
        return;
      }
      context.read<TicketController>().resolveTicket(widget.ticketNumber);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startPolling();
    } else {
      _pollTimer?.cancel();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TicketController>();
    final ticket = controller.findTicket(widget.ticketNumber);
    if (ticket == null) {
      return _TicketLookupState(
        loading: controller.error == null,
        message: controller.error ?? 'Unable to load this ticket.',
        onRetry: () => context.read<TicketController>().resolveTicket(
          widget.ticketNumber,
        ),
      );
    }
    final canConfirm = ticket.status == TicketStatus.awaitingConfirmation;
    final canCancel = _canCancelTicket(ticket.status);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'Back',
        ),
        titleSpacing: 0,
        title: const _QpmsWordmark(),
        actions: [
          if (canCancel)
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (value) {
                if (value == 'cancel') _showCancelTicket(ticket);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'cancel',
                  child: Text('Cancel Ticket'),
                ),
              ],
            )
          else
            const SizedBox(width: 12),
        ],
      ),
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (canConfirm || canCancel)
            _TicketBottomActions(
              canConfirm: canConfirm,
              canCancel: canCancel,
              onConfirm: () => Navigator.pushNamed(
                context,
                AppRoutes.feedback,
                arguments: ticket.number,
              ),
              onCancel: () => _showCancelTicket(ticket),
            ),
          const ClientBottomNav(currentRoute: AppRoutes.tickets),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () =>
              context.read<TicketController>().resolveTicket(widget.ticketNumber),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 18),
            children: [
              _TicketNumberHeader(ticket: ticket),
              const SizedBox(height: 12),
              _StatusHeroCard(ticket: ticket),
              const SizedBox(height: 16),
              _ServiceProgressCard(ticket: ticket),
              const SizedBox(height: 16),
              _IssueDetailsCard(ticket: ticket),
              if (ticket.status == TicketStatus.awaitingConfirmation &&
                  (ticket.resolutionNotes.isNotEmpty ||
                      ticket.completionPhotoAssets.isNotEmpty)) ...[
                const SizedBox(height: 16),
                _WorkCompletedCard(ticket: ticket),
              ],
              const SizedBox(height: 16),
              _TeamUpdateCard(ticket: ticket),
              const SizedBox(height: 16),
              _WhatHappensNextCard(ticket: ticket),
              if (ticket.status != TicketStatus.awaitingConfirmation &&
                  ticket.resolutionNotes.isNotEmpty) ...[
                const SizedBox(height: 14),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _CardTitle(
                        icon: Icons.task_alt_rounded,
                        title: 'Completion Remarks',
                      ),
                      const SizedBox(height: 10),
                      Text(
                        ticket.resolutionNotes,
                        style: const TextStyle(
                          height: 1.45,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (ticket.status == TicketStatus.cancelled) ...[
                const SizedBox(height: 14),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _CardTitle(
                        icon: Icons.cancel_outlined,
                        title: 'Cancellation',
                      ),
                      const SizedBox(height: 10),
                      Text(
                        ticket.cancellationReasonText.isEmpty
                            ? 'Client cancelled this ticket.'
                            : ticket.cancellationReasonText,
                        style: const TextStyle(
                          height: 1.45,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      if (ticket.cancelledAt != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          formatTicketDateTime(ticket.cancelledAt!),
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
              if (ticket.updates.isNotEmpty) ...[
                const SizedBox(height: 16),
                _CurrentTicketStatusCard(ticket: ticket),
              ],
              if (ticket.status == TicketStatus.closed &&
                  ticket.feedbackRating != null) ...[
                const SizedBox(height: 14),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _CardTitle(
                        icon: Icons.star_rounded,
                        title: 'Your feedback',
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: List.generate(
                          5,
                          (index) => Icon(
                            index < ticket.feedbackRating!
                                ? Icons.star_rounded
                                : Icons.star_border_rounded,
                            color: const Color(0xFFF59E0B),
                          ),
                        ),
                      ),
                      if (ticket.feedbackComment.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(ticket.feedbackComment),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showCancelTicket(Ticket ticket) async {
    final result = await showDialog<_CancellationChoice>(
      context: context,
      builder: (_) => const _CancelTicketDialog(),
    );
    if (result == null || !mounted) return;
    try {
      await context.read<TicketController>().cancelTicket(
        ticketNumber: ticket.number,
        reasonCode: result.code,
        reasonText: result.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ticket cancelled.')),
      );
    } catch (error) {
      if (!mounted) return;
      debugPrint('[Client Ticket Cancel] failed: $error');
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Unable to Cancel'),
          content: const Text(
            'Unable to cancel this ticket right now. Please try again.',
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
}

bool _canCancelTicket(TicketStatus status) => switch (status) {
  TicketStatus.open ||
  TicketStatus.assigned ||
  TicketStatus.accepted ||
  TicketStatus.inProgress ||
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened => true,
  TicketStatus.awaitingConfirmation ||
  TicketStatus.closed ||
  TicketStatus.cancelled => false,
};

class _TicketLookupState extends StatelessWidget {
  const _TicketLookupState({
    required this.loading,
    required this.message,
    required this.onRetry,
  });

  final bool loading;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      leading: IconButton(
        onPressed: () => Navigator.maybePop(context),
        icon: const Icon(Icons.arrow_back_rounded),
        tooltip: 'Back',
      ),
      title: const _QpmsWordmark(),
      titleSpacing: 0,
    ),
    bottomNavigationBar: const ClientBottomNav(currentRoute: AppRoutes.tickets),
    body: SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (loading)
                const CircularProgressIndicator()
              else
                const Icon(
                  Icons.confirmation_number_outlined,
                  size: 52,
                  color: AppColors.royalBlue,
                ),
              const SizedBox(height: 18),
              Text(
                loading ? 'Loading ticket...' : message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.deepBlue,
                  fontWeight: FontWeight.w900,
                  fontSize: 17,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Please refresh or return to My Tickets.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted),
              ),
              if (!loading) ...[
                const SizedBox(height: 18),
                FilledButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Retry'),
                ),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}

class _CancellationChoice {
  const _CancellationChoice(this.code, this.text);
  final String code;
  final String text;
}

class _QpmsWordmark extends StatelessWidget {
  const _QpmsWordmark();

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      const LogoMark(size: 32),
      const SizedBox(width: 7),
      const Text(
        'PMS',
        style: TextStyle(
          color: AppColors.deepBlue,
          fontSize: 22,
          height: 1,
          fontWeight: FontWeight.w900,
        ),
      ),
    ],
  );
}

class _TicketNumberHeader extends StatelessWidget {
  const _TicketNumberHeader({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        'Ticket Number',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          color: AppColors.muted,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        ticket.number,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          fontSize: 24,
          height: 1.1,
          fontWeight: FontWeight.w900,
          color: AppColors.deepBlue,
        ),
      ),
    ],
  );
}

class _StatusHeroCard extends StatelessWidget {
  const _StatusHeroCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final success = ticket.status == TicketStatus.awaitingConfirmation ||
        ticket.status == TicketStatus.closed;
    final statusColor = success ? AppColors.green : AppColors.royalBlue;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: success
              ? const [Color(0xFF059669), Color(0xFF16A34A)]
              : const [AppColors.deepBlue, AppColors.royalBlue],
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: statusColor.withValues(alpha: 0.24),
            blurRadius: 26,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 58,
                height: 58,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.24),
                  ),
                ),
                child: const Icon(
                  Icons.cleaning_services_rounded,
                  color: Colors.white,
                  size: 30,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        _clientStatusLabel(ticket.status).toUpperCase(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _statusHeroMessage(ticket.status),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 19,
                        height: 1.22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Divider(color: Colors.white.withValues(alpha: 0.24), height: 1),
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(
                Icons.location_on_rounded,
                color: Colors.white,
                size: 18,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  ticket.conciseLocation,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _HeroPriorityChip(priority: ticket.priority),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroPriorityChip extends StatelessWidget {
  const _HeroPriorityChip({required this.priority});

  final TicketPriority priority;

  @override
  Widget build(BuildContext context) {
    final color = switch (priority) {
      TicketPriority.high => AppColors.red,
      TicketPriority.medium => AppColors.orange,
      TicketPriority.low => AppColors.green,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        priorityLabel(priority),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _ServiceProgressCard extends StatelessWidget {
  const _ServiceProgressCard({required this.ticket});

  final Ticket ticket;

  static const _labels = [
    'Ticket\nRaised',
    'QPMS Team\nAssigned',
    'Work In\nProgress',
    'Work\nCompleted',
    'Your\nConfirmation',
  ];

  @override
  Widget build(BuildContext context) {
    final active = _stageIndex(ticket.status);
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Service Progress',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var index = 0; index < _labels.length; index++) ...[
                Expanded(
                  child: _TimelineStage(
                    label: _labels[index],
                    timestamp: _stageTimestamp(ticket, index),
                    complete: index < active || ticket.status == TicketStatus.closed,
                    active: index == active,
                  ),
                ),
                if (index < _labels.length - 1)
                  _TimelineConnector(
                    complete: index < active,
                    active: index == active,
                  ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _TimelineStage extends StatelessWidget {
  const _TimelineStage({
    required this.label,
    required this.complete,
    required this.active,
    this.timestamp,
  });

  final String label;
  final String? timestamp;
  final bool complete;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final color = complete
        ? AppColors.green
        : active
        ? AppColors.royalBlue
        : AppColors.line;
    return Column(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: complete
                ? AppColors.green
                : active
                ? Colors.white
                : const Color(0xFFF1F5F9),
            shape: BoxShape.circle,
            border: Border.all(color: color, width: 2),
          ),
          child: complete
              ? const Icon(Icons.check_rounded, size: 16, color: Colors.white)
              : Icon(
                  active ? Icons.cleaning_services_rounded : Icons.circle,
                  size: active ? 15 : 8,
                  color: active ? AppColors.royalBlue : AppColors.line,
                ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 10.2,
            height: 1.15,
            fontWeight: active || complete ? FontWeight.w900 : FontWeight.w700,
            color: active
                ? AppColors.royalBlue
                : complete
                ? AppColors.ink
                : AppColors.muted,
          ),
        ),
        if (timestamp != null) ...[
          const SizedBox(height: 5),
          Text(
            timestamp!,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 9.5,
              height: 1.15,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
        ],
      ],
    );
  }
}

class _TimelineConnector extends StatelessWidget {
  const _TimelineConnector({required this.complete, required this.active});

  final bool complete;
  final bool active;

  @override
  Widget build(BuildContext context) => Container(
    width: 12,
    margin: const EdgeInsets.only(top: 13),
    height: 2,
    decoration: BoxDecoration(
      color: complete || active ? AppColors.royalBlue : AppColors.line,
      borderRadius: BorderRadius.circular(999),
    ),
  );
}

class _IssueDetailsCard extends StatelessWidget {
  const _IssueDetailsCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final hasPhoto = ticket.complaintPhotoAssets.isNotEmpty;
    return AppCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Issue Details',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: 14),
          LayoutBuilder(
            builder: (context, constraints) {
              final photoWidth = (constraints.maxWidth * 0.38).clamp(118.0, 150.0);
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _IssueMeta(
                          icon: Icons.cleaning_services_rounded,
                          label: 'Category',
                          value: clientServiceLabel(ticket.category),
                        ),
                        const SizedBox(height: 14),
                        const Text(
                          'Description',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: AppColors.muted,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          ticket.description,
                          style: const TextStyle(
                            height: 1.4,
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 14),
                        _IssueMeta(
                          icon: Icons.location_on_rounded,
                          label: 'Location',
                          value: ticket.detailLocation,
                        ),
                        const SizedBox(height: 14),
                        _IssueMeta(
                          icon: Icons.schedule_rounded,
                          label: 'Raised',
                          value: formatTicketDateTime(ticket.raisedAt),
                        ),
                      ],
                    ),
                  ),
                  if (hasPhoto) ...[
                    const SizedBox(width: 12),
                    ClientPhotoThumbnail(
                      url: ticket.complaintPhotoAssets.first,
                      width: photoWidth,
                      height: 154,
                      label: 'Issue Evidence',
                    ),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _IssueMeta extends StatelessWidget {
  const _IssueMeta({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: AppColors.paleBlue,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, size: 18, color: AppColors.royalBlue),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: const TextStyle(
                fontSize: 13,
                height: 1.25,
                fontWeight: FontWeight.w900,
                color: AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

class _TeamUpdateCard extends StatelessWidget {
  const _TeamUpdateCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final latest = _latestClientSafeUpdate(ticket.updates);
    final name = _displayAssignee(ticket);
    final role = _displayRole(ticket);
    final message = latest?.body.trim().isNotEmpty == true
        ? latest!.body
        : _teamUpdateFallback(ticket.status);
    return AppCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'QPMS Team Update',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: AppColors.paleBlue,
                child: Text(
                  _initials(name),
                  style: const TextStyle(
                    color: AppColors.royalBlue,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
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
                            name,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w900,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        if (latest != null)
                          Text(
                            _compactTime(latest.dateTime),
                            style: const TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: AppColors.muted,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      role,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      message,
                      style: const TextStyle(
                        height: 1.4,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _WhatHappensNextCard extends StatelessWidget {
  const _WhatHappensNextCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.all(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'What happens next?',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.paleBlue,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: AppColors.royalBlue.withValues(alpha: 0.12),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.notifications_active_outlined,
                  color: AppColors.royalBlue,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _whatNextMessage(ticket.status),
                  style: const TextStyle(
                    height: 1.42,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.deepBlue,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _TicketBottomActions extends StatelessWidget {
  const _TicketBottomActions({
    required this.canConfirm,
    required this.canCancel,
    required this.onConfirm,
    required this.onCancel,
  });

  final bool canConfirm;
  final bool canCancel;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    bottom: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: AppColors.line)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (canConfirm) ...[
            const Text(
              'How was the service?',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w900,
                color: AppColors.deepBlue,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: onConfirm,
                    icon: const Icon(Icons.verified_rounded),
                    label: const Text('Confirm & Close'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onConfirm,
                    icon: const Icon(Icons.replay_rounded),
                    label: const Text('Not Satisfied'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.red,
                      side: const BorderSide(color: AppColors.red),
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'Selecting "Satisfied" will close this ticket. Selecting "Not Satisfied" will send it back to QPMS for further action.',
              textAlign: TextAlign.center,
              style: TextStyle(
                height: 1.3,
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: AppColors.muted,
              ),
            ),
          ],
          if (canCancel) ...[
            if (canConfirm) const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: onCancel,
              icon: const Icon(Icons.cancel_outlined),
              label: const Text('Cancel Ticket'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.red,
                side: const BorderSide(color: AppColors.red),
                minimumSize: const Size.fromHeight(50),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

class _CancelTicketDialog extends StatefulWidget {
  const _CancelTicketDialog();

  @override
  State<_CancelTicketDialog> createState() => _CancelTicketDialogState();
}

class _CancelTicketDialogState extends State<_CancelTicketDialog> {
  final _other = TextEditingController();
  String _selected = '';
  String? _error;

  static const _reasons = [
    ('raised_by_mistake', 'Raised by mistake'),
    ('issue_already_resolved', 'Issue already resolved / no longer required'),
    ('duplicate_complaint', 'Duplicate complaint'),
    ('wrong_location_or_category', 'Wrong location or complaint category'),
    ('other', 'Other'),
  ];

  @override
  void dispose() {
    _other.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Cancel Ticket'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Select a reason for cancelling this ticket.'),
          const SizedBox(height: 12),
          for (final reason in _reasons)
            RadioListTile<String>(
              value: reason.$1,
              groupValue: _selected,
              contentPadding: EdgeInsets.zero,
              title: Text(reason.$2),
              onChanged: (value) => setState(() {
                _selected = value ?? '';
                _error = null;
              }),
            ),
          if (_selected == 'other') ...[
            const SizedBox(height: 8),
            TextField(
              controller: _other,
              maxLines: 3,
              maxLength: 250,
              decoration: const InputDecoration(
                labelText: 'Other remarks',
                alignLabelWithHint: true,
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(
                color: AppColors.red,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Back'),
      ),
      FilledButton(
        onPressed: _submit,
        style: FilledButton.styleFrom(backgroundColor: AppColors.red),
        child: const Text('Confirm Cancellation'),
      ),
    ],
  );

  void _submit() {
    if (_selected.isEmpty) {
      setState(() => _error = 'Select a cancellation reason.');
      return;
    }
    final label = _reasons.firstWhere((reason) => reason.$1 == _selected).$2;
    final text = _selected == 'other' ? _other.text.trim() : label;
    if (_selected == 'other' && text.isEmpty) {
      setState(() => _error = 'Enter cancellation remarks.');
      return;
    }
    Navigator.pop(context, _CancellationChoice(_selected, text));
  }
}

class _WorkCompletedCard extends StatelessWidget {
  const _WorkCompletedCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.all(18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppColors.greenSoft,
                borderRadius: BorderRadius.circular(15),
              ),
              child: const Icon(Icons.verified_rounded, color: AppColors.green),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'WORK COMPLETED',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: AppColors.green,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Please review and confirm the service.',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (ticket.resolvedAt != null) ...[
          const SizedBox(height: 14),
          _InfoPill(
            icon: Icons.schedule_rounded,
            text: 'Completed ${formatTicketDateTime(ticket.resolvedAt!)}',
          ),
        ],
        if (ticket.assignedPerson.isNotEmpty) ...[
          const SizedBox(height: 8),
          _InfoPill(
            icon: Icons.engineering_rounded,
            text: 'Completed by QPMS Team',
          ),
        ],
        if (ticket.resolutionNotes.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text(
            'Completion Remarks',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            ticket.resolutionNotes,
            style: const TextStyle(
              height: 1.45,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
        ],
        if (ticket.completionPhotoAssets.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text(
            'Completion Evidence',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 156,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: ticket.completionPhotoAssets.length,
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (_, index) => ClientPhotoThumbnail(
                url: ticket.completionPhotoAssets[index],
                width: 230,
                height: 156,
                label: 'Completion Evidence',
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.paleBlue,
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Text(
            'Confirming will close this ticket.',
            style: TextStyle(
              height: 1.35,
              fontWeight: FontWeight.w800,
              color: AppColors.deepBlue,
            ),
          ),
        ),
      ],
    ),
  );
}

class _InfoPill extends StatelessWidget {
  const _InfoPill({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 17, color: AppColors.muted),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: AppColors.muted,
          ),
        ),
      ),
    ],
  );
}

String _clientStatusLabel(TicketStatus status) => switch (status) {
  TicketStatus.open => 'Ticket Received',
  TicketStatus.assigned => 'QPMS Team Assigned',
  TicketStatus.accepted || TicketStatus.inProgress => 'Work In Progress',
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened =>
    'Ticket Under Process',
  TicketStatus.awaitingConfirmation => 'Work Completed',
  TicketStatus.closed => 'Ticket Closed',
  TicketStatus.cancelled => 'Ticket Cancelled',
};

String _statusHeroMessage(TicketStatus status) => switch (status) {
  TicketStatus.open =>
    'Your housekeeping ticket has been received by QPMS.',
  TicketStatus.assigned =>
    'A QPMS team member has been assigned to your ticket.',
  TicketStatus.accepted || TicketStatus.inProgress =>
    'The QPMS team is currently attending this ticket.',
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened =>
    'QPMS is coordinating the appropriate team for your ticket.',
  TicketStatus.awaitingConfirmation =>
    'The housekeeping work has been completed. Please review and confirm the service.',
  TicketStatus.closed => 'This ticket has been completed and closed.',
  TicketStatus.cancelled => 'This ticket has been cancelled.',
};

String _whatNextMessage(TicketStatus status) => switch (status) {
  TicketStatus.open =>
    'QPMS is reviewing your ticket. You will be updated when a team member starts the work.',
  TicketStatus.assigned =>
    'Your ticket has been assigned to the QPMS team. Work will begin shortly.',
  TicketStatus.accepted || TicketStatus.inProgress =>
    'The QPMS team is currently attending the issue. You will be notified when the work is completed.',
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened =>
    'QPMS is coordinating the housekeeping team. You will receive an update when work begins.',
  TicketStatus.awaitingConfirmation =>
    'The work has been completed. Please review the completion evidence and confirm the service.',
  TicketStatus.closed => 'This ticket has been completed and closed.',
  TicketStatus.cancelled => 'No further action is required for this cancelled ticket.',
};

String _teamUpdateFallback(TicketStatus status) => switch (status) {
  TicketStatus.open => 'Your ticket is being reviewed by QPMS.',
  TicketStatus.assigned => 'Your ticket has been assigned to the QPMS team.',
  TicketStatus.accepted || TicketStatus.inProgress =>
    "Your ticket is currently being attended. We'll keep you updated.",
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened =>
    'Your ticket is under QPMS team review.',
  TicketStatus.awaitingConfirmation =>
    'The work has been completed and is ready for your confirmation.',
  TicketStatus.closed => 'This ticket has been closed after confirmation.',
  TicketStatus.cancelled => 'This ticket has been cancelled.',
};

int _stageIndex(TicketStatus status) => switch (status) {
  TicketStatus.open => 0,
  TicketStatus.assigned => 1,
  TicketStatus.accepted ||
  TicketStatus.inProgress ||
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.reopened =>
    2,
  TicketStatus.awaitingConfirmation => 3,
  TicketStatus.closed => 4,
  TicketStatus.cancelled => 0,
};

String? _stageTimestamp(Ticket ticket, int index) {
  final active = _stageIndex(ticket.status);
  if (index > active) return null;
  if (index == 0) return _compactDateTime(ticket.raisedAt);
  if (index == 3 && ticket.resolvedAt != null) {
    return _compactDateTime(ticket.resolvedAt!);
  }
  if (index == 4 && ticket.status == TicketStatus.closed) {
    return ticket.resolvedAt == null ? null : _compactDateTime(ticket.resolvedAt!);
  }
  final needle = switch (index) {
    1 => 'assign',
    2 => 'work',
    3 => 'complete',
    _ => '',
  };
  if (needle.isEmpty) return null;
  for (final update in ticket.updates) {
    final haystack = '${update.title} ${update.body}'.toLowerCase();
    if (haystack.contains(needle)) return _compactDateTime(update.dateTime);
  }
  return null;
}

String _displayAssignee(Ticket ticket) {
  final value = ticket.assignedPerson.trim();
  if (value.isEmpty || value.toLowerCase().contains('pending')) {
    return 'QPMS Housekeeping Team';
  }
  return value;
}

String _displayRole(Ticket ticket) {
  final value = ticket.assignedRole.trim();
  if (value.isEmpty) return 'Housekeeping Team';
  return value;
}

String _initials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'Q';
  if (parts.length == 1) return parts.first.characters.first.toUpperCase();
  return '${parts.first.characters.first}${parts.last.characters.first}'
      .toUpperCase();
}

String _compactTime(DateTime value) {
  final now = DateTime.now();
  final difference = now.difference(value);
  if (difference.inSeconds < 60) return 'Just now';
  if (difference.inMinutes < 60) return '${difference.inMinutes} min ago';
  return _compactDateTime(value);
}

String _compactDateTime(DateTime value) {
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
  final hour = value.hour == 0
      ? 12
      : value.hour > 12
      ? value.hour - 12
      : value.hour;
  final minute = value.minute.toString().padLeft(2, '0');
  final period = value.hour >= 12 ? 'PM' : 'AM';
  return '${value.day} ${months[value.month - 1]}, $hour:$minute $period';
}

class _CurrentTicketStatusCard extends StatelessWidget {
  const _CurrentTicketStatusCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _CardTitle(
          icon: Icons.info_outline_rounded,
          title: 'Current Ticket Status',
        ),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.paleBlue,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.royalBlue.withValues(alpha: 0.1)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _clientStatusLabel(ticket.status).toUpperCase(),
                style: const TextStyle(
                  color: AppColors.royalBlue,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.2,
                ),
              ),
              const SizedBox(height: 7),
              Text(
                _teamUpdateFallback(ticket.status),
                style: const TextStyle(
                  height: 1.4,
                  color: AppColors.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (_latestClientSafeUpdate(ticket.updates) case final update?) ...[
                const SizedBox(height: 8),
                Text(
                  'Updated: ${_compactTime(update.dateTime)}',
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

TicketUpdate? _latestClientSafeUpdate(List<TicketUpdate> updates) {
  for (final update in updates.reversed) {
    if (_isClientSafeUpdate(update)) return update;
  }
  return null;
}

bool _isClientSafeUpdate(TicketUpdate update) {
  if (update.isEscalation) return false;
  final text = '${update.title} ${update.body}'.toLowerCase();
  const blocked = [
    'assignment missing',
    'could not be assigned',
    'required active role',
    'role is not mapped',
    'role mapping',
    'mapping error',
    'escalation failed',
    'scheduler',
    'sla worker',
    'notification delivery',
    'firebase',
    'exception',
    'error',
    'failed',
  ];
  if (blocked.any((word) => text.contains(word))) return false;
  const allowed = [
    'ticket raised',
    'request raised',
    'created',
    'team assigned',
    'assigned',
    'accepted',
    'work started',
    'in progress',
    'progress',
    'completed',
    'confirmation',
    'reopened',
    'closed',
    'cancelled',
    'canceled',
  ];
  return allowed.any((word) => text.contains(word));
}

class _CardTitle extends StatelessWidget {
  const _CardTitle({required this.icon, required this.title});
  final IconData icon;
  final String title;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 19, color: AppColors.royalBlue),
      const SizedBox(width: 8),
      Text(
        title,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w900,
          color: AppColors.deepBlue,
        ),
      ),
    ],
  );
}
