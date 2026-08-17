import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_sla_policy.dart';

const hospitalTeal = Color(0xFF0F8B8D);
const hospitalGreen = Color(0xFF14804A);
const hospitalAmber = Color(0xFFD97706);
const hospitalRed = Color(0xFFDC2626);

class HospitalTicketCard extends StatelessWidget {
  const HospitalTicketCard({
    required this.ticket,
    required this.controller,
    required this.onTap,
    super.key,
  });

  final HospitalTicket ticket;
  final HospitalController controller;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final sla = controller.slaFor(ticket);
    final acceptanceRemaining = ticket.acceptanceDueAt?.difference(controller.now);
    final canAccept = controller.actionsFor(ticket).contains(HospitalTicketAction.accept);
    final slaColor = switch (sla.state) {
      HospitalSlaState.breached => hospitalRed,
      HospitalSlaState.nearBreach => hospitalAmber,
      HospitalSlaState.healthy => hospitalGreen,
      HospitalSlaState.notApplicable => qpmsBlue,
    };
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      ticket.ticketNumber.isEmpty ? ticket.id : ticket.ticketNumber,
                      style: const TextStyle(
                        color: qpmsBlue,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  _Badge(label: ticket.priority.label, color: _priorityColor()),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                ticket.block.isEmpty ? 'BLOCK NOT SPECIFIED' : ticket.block.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: hospitalRed,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                [
                  ticket.floor,
                  ticket.roomArea.isEmpty ? ticket.location : ticket.roomArea,
                ].where((part) => part.trim().isNotEmpty).join('\n').trim().isEmpty
                    ? 'Location snapshot unavailable'
                    : [
                        ticket.floor,
                        ticket.roomArea.isEmpty ? ticket.location : ticket.roomArea,
                      ].where((part) => part.trim().isNotEmpty).join('\n'),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 5),
              Text(ticket.category, style: const TextStyle(color: qpmsMuted)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _Badge(label: ticket.status.label, color: _statusColor()),
                  if (ticket.status ==
                          HospitalTicketStatus.awaitingSupervisorAcceptance &&
                      acceptanceRemaining != null)
                    _Badge(
                      label: acceptanceRemaining.isNegative
                          ? 'Acceptance expired'
                          : 'Accept in ${HospitalSlaPolicy.formatDuration(acceptanceRemaining)}',
                      color: acceptanceRemaining.isNegative
                          ? hospitalRed
                          : hospitalAmber,
                      prominent: true,
                    ),
                  _Badge(label: sla.label, color: slaColor, prominent: true),
                ],
              ),
              if (canAccept) ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: controller.isTicketBusy(ticket.id)
                        ? null
                        : () => _accept(context),
                    child: const Text('Accept'),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(Icons.person_outline, size: 17, color: qpmsMuted),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      ticket.responsibleRole.trim().isEmpty
                          ? ticket.responsiblePerson
                          : '${ticket.responsiblePerson} - ${ticket.responsibleRole}',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: qpmsMuted),
                    ),
                  ),
                  Text(
                    DateFormat('dd MMM, hh:mm a').format(ticket.raisedAt),
                    style: const TextStyle(fontSize: 11, color: qpmsMuted),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _priorityColor() => switch (ticket.priority) {
    HospitalPriority.high => hospitalRed,
    HospitalPriority.medium => hospitalAmber,
    HospitalPriority.low => hospitalGreen,
  };

  Color _statusColor() => switch (ticket.status) {
    HospitalTicketStatus.closed ||
    HospitalTicketStatus.resolvedAwaitingConfirmation => hospitalGreen,
    HospitalTicketStatus.awaitingSupervisorAcceptance => hospitalAmber,
    HospitalTicketStatus.escalatedOperationsExecutive ||
    HospitalTicketStatus.escalatedFacilityManager ||
    HospitalTicketStatus.escalatedProjectHead ||
    HospitalTicketStatus.reopened => hospitalRed,
    HospitalTicketStatus.inProgress ||
    HospitalTicketStatus.accepted => hospitalTeal,
    _ => qpmsBlue,
  };

  Future<void> _accept(BuildContext context) async {
    try {
      await controller.accept(ticket.id);
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Ticket is currently assigned. Refreshing latest status.'),
        ),
      );
      await controller.loadDetail(ticket.id, force: true);
    }
  }
}

class _Badge extends StatelessWidget {
  const _Badge({
    required this.label,
    required this.color,
    this.prominent = false,
  });

  final String label;
  final Color color;
  final bool prominent;

  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.symmetric(
      horizontal: prominent ? 11 : 9,
      vertical: prominent ? 7 : 5,
    ),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.11),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(
      label,
      style: TextStyle(
        color: color,
        fontSize: prominent ? 12 : 11,
        fontWeight: FontWeight.w900,
      ),
    ),
  );
}
