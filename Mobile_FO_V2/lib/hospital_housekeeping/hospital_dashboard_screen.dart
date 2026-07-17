import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_ticket_card.dart';
import 'hospital_ticket_detail_screen.dart';

class HospitalDashboardScreen extends StatelessWidget {
  const HospitalDashboardScreen({required this.controller, super.key});

  final HospitalController controller;

  @override
  Widget build(BuildContext context) {
    final summary = controller.summary;
    final items = <(String, int, IconData, Color)>[
      (
        'New Complaints',
        summary.newComplaints,
        Icons.new_releases_outlined,
        qpmsBlue,
      ),
      ('Open', summary.open, Icons.inbox_outlined, qpmsBlue),
      (
        'Assigned',
        summary.assigned,
        Icons.assignment_ind_outlined,
        hospitalTeal,
      ),
      (
        'In Progress',
        summary.inProgress,
        Icons.cleaning_services_outlined,
        hospitalTeal,
      ),
      (
        'Near SLA Breach',
        summary.nearBreach,
        Icons.timer_outlined,
        hospitalAmber,
      ),
      (
        'Escalated',
        summary.escalated,
        Icons.warning_amber_rounded,
        hospitalRed,
      ),
      (
        'Awaiting Confirmation',
        summary.awaitingConfirmation,
        Icons.fact_check_outlined,
        hospitalGreen,
      ),
      ('Reopened', summary.reopened, Icons.replay_rounded, hospitalRed),
      (
        'Closed Today',
        summary.closedToday,
        Icons.task_alt_rounded,
        hospitalGreen,
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
                '${controller.session.role.label} • ${controller.session.assignedBlock ?? 'All Blocks'}',
                style: const TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
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
            return Container(
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
            );
          },
        ),
        const SizedBox(height: 22),
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
