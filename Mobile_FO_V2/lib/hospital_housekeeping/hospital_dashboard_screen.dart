import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_ticket_card.dart';
import 'hospital_ticket_detail_screen.dart';
import 'hospital_tickets_screen.dart';

class HospitalDashboardScreen extends StatelessWidget {
  const HospitalDashboardScreen({required this.controller, super.key});

  final HospitalController controller;

  @override
  Widget build(BuildContext context) {
    final summary = controller.summary;
    final items = <(String, int, IconData, Color, HospitalTicketListFilter)>[
      (
        'New Assignments',
        summary.newComplaints,
        Icons.new_releases_outlined,
        qpmsBlue,
        HospitalTicketListFilter.newAssignments,
      ),
      (
        'Awaiting Acceptance',
        summary.awaitingAcceptance,
        Icons.inbox_outlined,
        qpmsBlue,
        HospitalTicketListFilter.awaitingAcceptance,
      ),
      (
        'Assigned',
        summary.assigned,
        Icons.assignment_ind_outlined,
        hospitalTeal,
        HospitalTicketListFilter.awaitingAcceptance,
      ),
      (
        'In Progress',
        summary.inProgress,
        Icons.cleaning_services_outlined,
        hospitalTeal,
        HospitalTicketListFilter.inProgress,
      ),
      (
        'Due Soon',
        summary.dueSoon,
        Icons.timer_outlined,
        hospitalAmber,
        HospitalTicketListFilter.dueSoon,
      ),
      (
        'SLA Breached',
        summary.breached,
        Icons.timer_off_outlined,
        hospitalRed,
        HospitalTicketListFilter.breached,
      ),
      (
        'Escalated',
        summary.escalated,
        Icons.warning_amber_rounded,
        hospitalRed,
        HospitalTicketListFilter.escalated,
      ),
      (
        'Reopened',
        summary.reopened,
        Icons.replay_rounded,
        hospitalRed,
        HospitalTicketListFilter.reopened,
      ),
      (
        'Resolved Today',
        summary.closedToday,
        Icons.task_alt_rounded,
        hospitalGreen,
        HospitalTicketListFilter.resolvedToday,
      ),
      if (controller.session.role != HospitalDemoRole.supervisor)
        (
          'Unassigned',
          summary.unassigned,
          Icons.assignment_late_outlined,
          hospitalAmber,
          HospitalTicketListFilter.unassigned,
        ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 120),
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [qpmsBlue, hospitalTeal]),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Hospital Housekeeping',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                controller.session.displayName,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                [
                  controller.session.role.label,
                  if (controller.session.shiftLabel.isNotEmpty)
                    controller.session.shiftLabel,
                  controller.session.clientName.isEmpty
                      ? 'NIMS Hyderabad'
                      : controller.session.clientName,
                ].join(' - '),
                style: const TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (controller.session.role == HospitalDemoRole.supervisor) ...[
          _DutyControl(controller: controller),
          const SizedBox(height: 16),
        ],
        if (controller.canViewSupervisorAvailability) ...[
          _SupervisorAvailabilityCard(controller: controller),
          const SizedBox(height: 16),
        ],
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: items.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            crossAxisSpacing: 9,
            mainAxisSpacing: 9,
            childAspectRatio: 1.05,
          ),
          itemBuilder: (_, index) {
            final item = items[index];
            return InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => HospitalTicketsScreen(
                    controller: controller,
                    initialFilter: item.$5,
                  ),
                ),
              ),
              child: Container(
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(item.$3, color: item.$4, size: 21),
                    const Spacer(),
                    Text(
                      '${item.$2}',
                      style: TextStyle(
                        color: item.$4,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      item.$1,
                      maxLines: 2,
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 22),
        if (controller.session.role == HospitalDemoRole.supervisor &&
            controller.incomingTickets.isNotEmpty) ...[
          const Text(
            'Incoming tickets',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 4),
          const Text(
            'Review the block, floor and area. Accept only if it is under your responsibility.',
            style: TextStyle(color: qpmsMuted, fontSize: 12),
          ),
          const SizedBox(height: 12),
          ...controller.incomingTickets.take(4).map(
                (ticket) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: HospitalTicketCard(
                    ticket: ticket,
                    controller: controller,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => HospitalTicketDetailScreen(
                          controller: controller,
                          ticketId: ticket.id,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          const SizedBox(height: 12),
        ],
        const Text(
          'Urgent tickets',
          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 4),
        const Text(
          'Ordered by SLA breach, remaining time, priority and age.',
          style: TextStyle(color: qpmsMuted, fontSize: 12),
        ),
        const SizedBox(height: 12),
        if (controller.urgentTickets.isEmpty)
          const _EmptyState()
        else
          ...controller.urgentTickets
              .take(6)
              .map(
                (ticket) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: HospitalTicketCard(
                    ticket: ticket,
                    controller: controller,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => HospitalTicketDetailScreen(
                          controller: controller,
                          ticketId: ticket.id,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
      ],
    );
  }
}

class _DutyControl extends StatelessWidget {
  const _DutyControl({required this.controller});

  final HospitalController controller;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        children: [
          Row(
            children: [
              Icon(
                controller.isOnDuty
                    ? Icons.verified_user_outlined
                    : Icons.pause_circle_outline,
                color: controller.isOnDuty ? hospitalGreen : hospitalAmber,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      controller.isOnDuty ? 'On Duty' : 'Off Duty',
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const Text(
                      'On-Duty Supervisors receive incoming NIMS housekeeping tickets for their assigned blocks.',
                      style: TextStyle(color: qpmsMuted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              FilledButton.tonal(
                onPressed: () => _toggleDuty(context),
                child: Text(controller.isOnDuty ? 'End Duty' : 'Start Duty'),
              ),
            ],
          ),
          if (controller.session.shiftLabel.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.schedule_outlined, size: 18, color: qpmsMuted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    controller.isOnDuty
                        ? 'Scheduled Shift: ${controller.session.shiftLabel}'
                        : 'Scheduled Shift: ${controller.session.shiftLabel}. Start Duty to receive Hospital tickets.',
                    style: TextStyle(
                      color: controller.isOnDuty ? qpmsMuted : hospitalAmber,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    ),
  );

  Future<void> _toggleDuty(BuildContext context) async {
    if (!controller.isOnDuty) {
      await controller.startDuty();
      return;
    }
    if (controller.myAcceptedTickets.isEmpty) {
      await controller.endDuty();
      return;
    }
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('End Duty?'),
        content: const Text(
          'You currently have active Hospital tickets. Existing tickets will remain assigned to you. Please coordinate handover before ending duty.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('End Duty'),
          ),
        ],
      ),
    );
    if (confirm == true) await controller.endDuty();
  }
}

class _SupervisorAvailabilityCard extends StatelessWidget {
  const _SupervisorAvailabilityCard({required this.controller});

  final HospitalController controller;

  @override
  Widget build(BuildContext context) {
    final summary = controller.supervisorAvailability;
    final supervisors = summary?.supervisors ?? const [];
    final preview = supervisors
        .where(
          (row) =>
              row.status == HospitalSupervisorAvailabilityStatus.onDuty ||
              row.status ==
                  HospitalSupervisorAvailabilityStatus.dutyNotStarted,
        )
        .take(3)
        .toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Supervisor Availability',
                    style: TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                TextButton(
                  onPressed: summary == null
                      ? null
                      : () => _showSupervisorAvailability(context, summary),
                  child: const Text('View All'),
                ),
              ],
            ),
            const SizedBox(height: 4),
            if (summary == null)
              const Text(
                'Availability will appear on the next refresh.',
                style: TextStyle(color: qpmsMuted, fontSize: 12),
              )
            else ...[
              Wrap(
                spacing: 10,
                runSpacing: 6,
                children: [
                  _AvailabilityCount(
                    value: summary.onDuty,
                    label: 'On Duty',
                    color: hospitalGreen,
                  ),
                  _AvailabilityCount(
                    value: summary.dutyNotStarted,
                    label: 'Duty Not Started',
                    color: hospitalAmber,
                  ),
                  _AvailabilityCount(
                    value: summary.offShift,
                    label: 'Off Shift',
                    color: qpmsMuted,
                  ),
                  if (summary.staleTrackingSupported)
                    _AvailabilityCount(
                      value: summary.offlineStale,
                      label: 'Offline/Stale',
                      color: hospitalRed,
                    ),
                ],
              ),
              const SizedBox(height: 10),
              if (preview.isEmpty)
                const Text(
                  'No supervisors are on duty or inside scheduled shift.',
                  style: TextStyle(color: qpmsMuted, fontSize: 12),
                )
              else
                ...preview.map(
                  (row) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: _SupervisorAvailabilityRow(row: row, compact: true),
                  ),
                ),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _showSupervisorAvailability(context, summary),
                  icon: const Icon(Icons.groups_2_outlined),
                  label: Text('View All ${supervisors.length} Supervisors'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  void _showSupervisorAvailability(
    BuildContext context,
    HospitalSupervisorAvailabilitySummary summary,
  ) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: .82,
          minChildSize: .45,
          maxChildSize: .95,
          builder: (context, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
            children: [
              const Text(
                'Supervisor Availability',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 4),
              Text(
                '${summary.onDuty} On Duty - ${summary.dutyNotStarted} Duty Not Started - ${summary.offShift} Off Shift',
                style: const TextStyle(color: qpmsMuted, fontSize: 12),
              ),
              const SizedBox(height: 14),
              ...summary.supervisors.map(
                (row) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _SupervisorAvailabilityRow(row: row),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AvailabilityCount extends StatelessWidget {
  const _AvailabilityCount({
    required this.value,
    required this.label,
    required this.color,
  });

  final int value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(
    '$value $label',
    style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w900),
  );
}

class _SupervisorAvailabilityRow extends StatelessWidget {
  const _SupervisorAvailabilityRow({required this.row, this.compact = false});

  final HospitalSupervisorAvailability row;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final color = switch (row.status) {
      HospitalSupervisorAvailabilityStatus.onDuty => hospitalGreen,
      HospitalSupervisorAvailabilityStatus.dutyNotStarted => hospitalAmber,
      HospitalSupervisorAvailabilityStatus.offlineStale => hospitalRed,
      HospitalSupervisorAvailabilityStatus.offShift => qpmsMuted,
    };
    return Container(
      padding: EdgeInsets.all(compact ? 0 : 12),
      decoration: compact
          ? null
          : BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: qpmsBorder),
            ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.circle, size: 10, color: color),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                Text(
                  compact
                      ? row.areaLabel
                      : '${row.shiftLabel}\n${row.areaLabel}',
                  maxLines: compact ? 1 : 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: qpmsMuted, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            row.statusLabel,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) => const Card(
    child: Padding(
      padding: EdgeInsets.all(24),
      child: Column(
        children: [
          Icon(Icons.cleaning_services_outlined, color: hospitalTeal, size: 34),
          SizedBox(height: 8),
          Text('No active complaints in your assigned scope.'),
        ],
      ),
    ),
  );
}
