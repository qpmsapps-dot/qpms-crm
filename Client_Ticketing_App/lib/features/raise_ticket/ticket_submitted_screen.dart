import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/chips.dart';
import '../../models/ticket.dart';
import '../../state/ticket_controller.dart';

class TicketSubmittedScreen extends StatelessWidget {
  const TicketSubmittedScreen({required this.ticketNumber, super.key});
  final String ticketNumber;

  @override
  Widget build(BuildContext context) {
    final ticket = context.watch<TicketController>().ticketByNumber(
      ticketNumber,
    );
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 38, 20, 28),
          children: [
            const CircleAvatar(
              radius: 38,
              backgroundColor: Color(0xFFDCFCE7),
              child: Icon(
                Icons.check_rounded,
                size: 44,
                color: AppColors.green,
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Complaint raised',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w900,
                color: AppColors.deepBlue,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'The Housekeeping Supervisor has been notified. You can track every update from My Tickets.',
              textAlign: TextAlign.center,
              style: TextStyle(height: 1.45, color: AppColors.muted),
            ),
            const SizedBox(height: 22),
            AppCard(
              child: Column(
                children: [
                  const Text(
                    'TICKET ID',
                    style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.2,
                      fontWeight: FontWeight.w800,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  SelectableText(
                    ticket.number,
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                      color: AppColors.royalBlue,
                    ),
                  ),
                  const Divider(height: 28),
                  _DetailRow(
                    'Date & Time',
                    formatTicketDateTime(ticket.raisedAt),
                  ),
                  _DetailRow(
                    'Block / Floor',
                    '${ticket.block} • ${ticket.floor}',
                  ),
                  _DetailRow('Location', ticket.location),
                  _DetailRow('Category', ticket.category),
                  _DetailRow(
                    'Priority',
                    priorityLabel(ticket.priority),
                    trailing: PriorityChip(ticket.priority),
                  ),
                  _DetailRow(
                    'Status',
                    'Open',
                    trailing: const StatusChip(TicketStatus.open),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => Navigator.pushReplacementNamed(
                context,
                AppRoutes.ticketDetails,
                arguments: ticket.number,
              ),
              child: const Text('Track This Ticket'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => Navigator.pushNamedAndRemoveUntil(
                context,
                AppRoutes.dashboard,
                (_) => false,
              ),
              child: const Text('Back to Home'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value, {this.trailing});
  final String label;
  final String value;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 105,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
        ),
        Expanded(
          child:
              trailing ??
              Text(
                value,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
        ),
      ],
    ),
  );
}
