import 'package:flutter/material.dart';

import '../../models/ticket.dart';
import '../constants/app_colors.dart';

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final TicketStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      TicketStatus.open => AppColors.royalBlue,
      TicketStatus.assigned => AppColors.purple,
      TicketStatus.accepted => AppColors.orange,
      TicketStatus.inProgress => AppColors.orange,
      TicketStatus.escalatedOperations => AppColors.orange,
      TicketStatus.escalatedFacilityManager => AppColors.red,
      TicketStatus.awaitingConfirmation => AppColors.green,
      TicketStatus.reopened => AppColors.red,
      TicketStatus.closed => AppColors.green,
      TicketStatus.cancelled => AppColors.muted,
    };
    return _LabelChip(label: shortStatusLabel(status), color: color);
  }
}

class PriorityChip extends StatelessWidget {
  const PriorityChip(this.priority, {super.key});
  final TicketPriority priority;

  @override
  Widget build(BuildContext context) {
    final color = switch (priority) {
      TicketPriority.low => AppColors.green,
      TicketPriority.medium => AppColors.orange,
      TicketPriority.high => AppColors.red,
    };
    return _LabelChip(label: priorityLabel(priority), color: color);
  }
}

class _LabelChip extends StatelessWidget {
  const _LabelChip({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w800,
          fontSize: 11,
        ),
      ),
    );
  }
}
